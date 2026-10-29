/**
 * The downloaded / printed hurdle plan (fix 2026-10-28, walkthrough T02).
 *
 * Before: every line of hurdlePlanText() became a bare <p>, with no headings
 * and no hierarchy. Now the print page is built from the plan's STRUCTURE,
 * the same data HurdlePlanView renders, styled like the app's other print
 * outputs (Library PDF, interview analysis): Georgia on white, green section
 * rules, the person's own words set apart in a box.
 *
 * Same content as the plain-text copy (hurdlePlanText): no new facts and no
 * new advice. PURE, so tests can prove what is (and is not) in it.
 * - Every piece of user or model text goes through escapeHtml.
 * - Empty parts are left out, never printed blank.
 * - The record hurdle's own section is left out when the record plan is
 *   shown (as on screen and in the text copy), and its "what you told us"
 *   lines are never printed (the screen hides them).
 * - t.ROY's reading prints only when the caller passes it, which the page
 *   does only while the reading is shown on screen.
 */

import { escapeHtml } from "../escape-html";
import { COACHING_LINE, type HurdleSection, type RecordConversation } from "./plan";

type PrintablePlan = { hurdles: Omit<HurdleSection, "fromSensitive">[]; record: RecordConversation | null };

export interface PlanPrintOptions {
  targetJob?: string | null;
  /** The date line, already formatted (e.g. "October 28, 2026"). */
  date: string;
  /** t.ROY's reading per hurdle. Pass only while the reading is shown on screen. */
  summaries?: Partial<Record<string, string>>;
}

const e = escapeHtml;

function list(title: string, items: string[]): string {
  const xs = items.filter((x) => typeof x === "string" && x.trim());
  if (!xs.length) return "";
  return `<h3>${e(title)}</h3><ul>${xs.map((x) => `<li>${e(x)}</li>`).join("")}</ul>`;
}

function recordPart(r: RecordConversation): string {
  const f = r.legalFloor;
  const sources = f.sources.length
    ? `<h3>Dated sources (verify before relying, list as of ${e(f.asOf)})</h3><ul class="sources">${f.sources
        .map((s) => `<li><span class="src">${e(s.title)}</span><br /><span class="url">${e(s.url)}</span> <span class="checked">(checked ${e(s.asOf)})</span></li>`)
        .join("")}</ul>`
    : "";
  return [
    `<section class="record" data-part="record">`,
    `<h2>Plan what to say about the record</h2>`,
    `<p class="private">Not saved anywhere. This copy is yours.</p>`,
    list("When it comes up", r.whenToBringItUp),
    r.open ? `<h3>What to say</h3><blockquote class="own">${e(r.open)}</blockquote>` : "",
    r.next ? `<h3>What to say next</h3><blockquote class="own">${e(r.next)}</blockquote>` : "",
    sources,
    f.staleNote ? `<p class="note">${e(f.staleNote)}</p>` : "",
    r.disclaimer ? `<p class="disclaimer">${e(r.disclaimer)}</p>` : "",
    `</section>`,
  ].join("");
}

function hurdlePart(s: Omit<HurdleSection, "fromSensitive">, reading: string | undefined): string {
  const parts = [
    s.hurdle !== "record" ? list("What you told us", s.known) : "",
    reading && reading.trim() ? `<p class="reading"><span class="label">t.ROY's reading of your answers:</span> ${e(reading)}</p>` : "",
    list("Still open", s.open),
    list("Do now", s.doNow),
    list("What to ask an employer", s.askEmployer),
    s.tell && s.tell.trim() ? `<h3>What you tell an employer</h3><blockquote class="own">${e(s.tell)}</blockquote>` : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return `<section class="hurdle" data-part="${e(s.hurdle)}"><h2>${e(s.label)}</h2>${parts.join("")}</section>`;
}

const STYLE = `
  @page { size: letter; margin: 0.85in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; background: #fff; font-size: 12pt; line-height: 1.6; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  .subtitle { font-size: 9.5pt; color: #777; margin: 0 0 16pt; }
  .coaching { border: 1pt solid #4D7C5A; background: #f8f5f0; padding: 8pt 12pt; margin: 0 0 8pt; font-size: 10pt; }
  h2 { font-size: 10pt; font-weight: bold; color: #2d5a3d; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1pt solid #4D7C5A; padding-bottom: 3pt; margin: 22pt 0 8pt; }
  h3 { font-size: 9.5pt; font-weight: bold; color: #555; text-transform: uppercase; letter-spacing: 0.06em; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  ul { margin: 0 0 8pt; padding-left: 18pt; } li { margin-bottom: 4pt; }
  blockquote.own { border-left: 3pt solid #4D7C5A; margin: 0 0 8pt; padding: 6pt 12pt; color: #222; background: #f8f5f0; }
  .private { font-size: 10pt; font-weight: bold; color: #8a5a00; }
  .reading { font-size: 10.5pt; color: #333; }
  .reading .label { font-weight: bold; }
  .sources li { font-size: 10pt; }
  .src { font-weight: bold; }
  .url, .checked { font-size: 9pt; color: #555; word-break: break-all; }
  .note { font-size: 10pt; color: #8a5a00; }
  .disclaimer { font-size: 10pt; font-weight: bold; }
  @media screen { body { max-width: 7in; margin: 0.6in auto; padding: 0 16px; } }
  section { break-inside: avoid-page; }
  h2, h3 { break-after: avoid; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/** The whole print page for the hurdle plan. Pure. */
export function buildHurdlePlanPrintHtml(plan: PrintablePlan, opts: PlanPrintOptions): string {
  const job = (opts.targetJob ?? "").trim();
  const summaries = opts.summaries ?? {};
  const body = [
    plan.record ? recordPart(plan.record) : "",
    ...plan.hurdles
      .filter((s) => !(s.hurdle === "record" && plan.record))
      .map((s) => hurdlePart(s, summaries[s.hurdle])),
  ].join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Your plan</title><style>${STYLE}</style></head><body>`
    + `<h1>Your plan${job ? `: ${e(job)}` : ""}</h1>`
    + `<p class="subtitle">Built with The Refinery &bull; steelmanresumes.com &bull; ${e(opts.date)}</p>`
    + `<div class="coaching"><strong>${e(COACHING_LINE)}</strong> Built from your answers. Anything you didn't answer stays open.</div>`
    + body
    + `</body></html>`;
}
