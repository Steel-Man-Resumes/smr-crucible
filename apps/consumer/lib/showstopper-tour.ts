/**
 * The "Building your story" tour: turns mint-check findings on the person's
 * current page into short t.ROY notes, one per flagged line.
 *
 * Pure: no I/O, no network, no model. Runs in the browser on the text the
 * person already gave (session.resumeText). The page shows a flaw only when
 * the checker produced it; this module never adds one.
 *
 * The page is checked against itself: the person's own resume is their own
 * words, so only the checks that read a page on its own can fire here
 * (placeholders, empty sections, missing dates or titles, tool marks, long
 * dashes, credentials with no year or status, shared work written as solo
 * work elsewhere on the same page).
 */

import {
  runMintCheck,
  checkCredentialStatus,
  type MintFinding,
} from "@crucible/core/src/resumeMintCheckShared";

export interface TourStep {
  /** Stable key for React lists. */
  id: string;
  /** Index into `lines` (the raw lines of the page, blank lines included). */
  lineIndex: number;
  /** The flagged line as it appears on the page. */
  line: string;
  severity: "BLOCK" | "FIX";
  /** What t.ROY says about it. Plain words, no rule codes. */
  note: string;
}

export interface ResumeTour {
  /** The page split into lines exactly as rendered (trailing spaces trimmed). */
  lines: string[];
  steps: TourStep[];
  /** Set when the checker found nothing to show. */
  cleanNote?: string;
}

export const TOUR_CAP = 6;

export const CLEAN_NOTE =
  "Your page is already clean on the basics. I'm building the full version now.";

const YEAR_RE = /\b(?:19[5-9]\d|20[0-4]\d)\b/;

interface NotePair {
  first: string;
  again: string;
}

/** Which note a finding gets. Keyed by rule plus kind (or the dash flavor). */
function noteKey(f: MintFinding): string {
  if (f.rule === "STD-A02") return /date range/i.test(f.why) ? "dash_range" : "dash";
  return f.kind ? `${f.rule}:${f.kind}` : f.rule;
}

const NOTES: Record<string, NotePair> = {
  "STD-F05": {
    first: "There's a blank still sitting on this line. The new page won't print blanks, and I check for them before it's called done.",
    again: "Another blank here. Same fix: it comes off or gets your real detail.",
  },
  "STD-F02:empty_section": {
    first: "This part says there's nothing in it. The new page just leaves a section off when there's nothing for it.",
    again: "Same here. An empty section comes off.",
  },
  "STD-F02:missing_title": {
    first: "This job is missing a title or a company name. Employers look for both. If one is still missing on the new page, I'll flag it so you can fill it in.",
    again: "This one is missing a title or a company too. I'll flag it the same way.",
  },
  "STD-F01": {
    first: "This job has no dates on it. Employers notice that fast. The new page won't guess a date, and if one is missing I'll flag it for you to fill in.",
    again: "No dates on this job either. Same deal: no guessing, and I'll flag it.",
  },
  "STD-F01:dateless_page": {
    first: "There are no dates anywhere on this page. That reads like something is being hidden. The new page goes by date, using only the dates you give.",
    again: "Still no dates here. The new page goes by date.",
  },
  "STD-F06": {
    first: "This line names a resume tool. The new page reads as yours, with no tool's name on it.",
    again: "Another tool name here. It comes off.",
  },
  dash: {
    first: "Long dashes like this one can make a page read as machine-made. The new page uses plain periods and commas.",
    again: "Another long dash. Same fix on the new page.",
  },
  dash_range: {
    first: "That long dash in the dates can read as machine-made. The new page uses a plain hyphen.",
    again: "Same long dash in these dates. Plain hyphen on the new page.",
  },
  "STD-T01:sole_actor": {
    first: "Another line on this page says you helped with this work. This line makes it sound like you did it alone. The new page keeps shared work shared.",
    again: "Same here: shared work stays shared on the new page.",
  },
  "STD-T03:credential_status": {
    first: "This one has no year or status on it, so a reader can't tell if it's still good. The new page won't guess, so have that answer ready.",
    again: "Same with this one: no year or status. Have it ready.",
  },
};

const GENERIC: NotePair = {
  first: "This line is worth a second look. The new page gets checked line by line against your own words.",
  again: "This one too. It gets the same line-by-line check.",
};

/** The raw page lines the tour anchors to. */
export function pageLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
}

/** Index of the raw line a finding is about, or -1 when it can't be placed. */
function anchorOf(lines: string[], findingLine: string): number {
  const want = findingLine.trim();
  if (!want) return -1;
  const exact = lines.findIndex((l) => l.trim() === want);
  if (exact >= 0) return exact;
  return lines.findIndex((l) => l.includes(want));
}

function nextNonBlank(lines: string[], i: number): string {
  for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
  return "";
}

/**
 * Showing fewer flaws is always safe; showing a wrong one is not. The
 * checker reads "June 2021 - Present (3 years)" under a job header as not a
 * date line, so it says that job has no dates. Drop a no-dates finding when
 * the line right under the job carries a year.
 */
function looksLikeFalseAlarm(f: MintFinding, lines: string[], at: number): boolean {
  if (f.rule === "STD-F01" && !f.kind) return YEAR_RE.test(nextNonBlank(lines, at));
  return false;
}

const SEVERITY_RANK = { BLOCK: 0, FIX: 1 } as const;

/**
 * Build the tour for a page. Returns null when there is no page (no text), so
 * the screen never fakes a "before".
 */
export function buildResumeTour(resumeText: string | undefined | null, cap: number = TOUR_CAP): ResumeTour | null {
  const text = (resumeText ?? "").trim() ? (resumeText as string) : "";
  if (!text) return null;
  const lines = pageLines(text);

  const mint = runMintCheck({ output: text, source: text, kind: "resume" });
  const findings = [...mint.findings, ...checkCredentialStatus(text, text)];

  // Place each finding on a line; one step per line (the more serious wins).
  type Placed = { f: MintFinding; at: number; key: string };
  const placed: Placed[] = [];
  for (const f of findings) {
    const at = anchorOf(lines, f.line);
    if (at < 0 || looksLikeFalseAlarm(f, lines, at)) continue;
    placed.push({ f, at, key: noteKey(f) });
  }
  placed.sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.at - b.at);
  const byLine = new Map<number, Placed>();
  for (const p of placed) if (!byLine.has(p.at)) byLine.set(p.at, p);
  const unique = [...byLine.values()];

  // Variety first: one of each kind of flaw, then fill up to the cap.
  const chosen: Placed[] = [];
  const kinds = new Set<string>();
  for (const p of unique) {
    if (chosen.length >= cap) break;
    if (kinds.has(p.key)) continue;
    kinds.add(p.key);
    chosen.push(p);
  }
  for (const p of unique) {
    if (chosen.length >= cap) break;
    if (!chosen.includes(p)) chosen.push(p);
  }
  chosen.sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.at - b.at);

  const used = new Set<string>();
  const steps: TourStep[] = chosen.map((p) => {
    const pair = NOTES[p.key] ?? GENERIC;
    const note = used.has(p.key) ? pair.again : pair.first;
    used.add(p.key);
    return {
      id: `${p.at}-${p.key}`,
      lineIndex: p.at,
      line: lines[p.at],
      severity: p.f.severity,
      note,
    };
  });

  return steps.length ? { lines, steps } : { lines, steps, cleanNote: CLEAN_NOTE };
}

// ---- Jobs the person typed (no page to mark up) ---------------------------

export interface JobCard {
  title: string;
  company: string;
  /** Dates exactly as given, or "" when none. */
  dates: string;
}

interface WorkEntryLike {
  title?: string;
  company?: string;
  startDate?: string;
  endDate?: string;
}

interface CarriedJobLike {
  kind?: string;
  title?: string;
  yearStarted?: number | null;
  yearApprox?: boolean;
  yearEnded?: number | null;
  endApprox?: boolean;
}

const yearText = (y: number | null | undefined, approx?: boolean) =>
  typeof y === "number" ? `${approx ? "about " : ""}${y}` : "";

/** The jobs the person entered, as plain cards. Never invents a field. */
export function jobCardsFrom(
  experience: WorkEntryLike[] | undefined,
  carried: CarriedJobLike[] | undefined
): JobCard[] {
  const fromDoc = (experience ?? [])
    .filter((e) => (e.title ?? "").trim() || (e.company ?? "").trim())
    .map((e) => {
      const start = (e.startDate ?? "").trim();
      const end = (e.endDate ?? "").trim();
      return {
        title: (e.title ?? "").trim(),
        company: (e.company ?? "").trim(),
        dates: start ? `${start} - ${end || "Present"}` : end,
      };
    });
  if (fromDoc.length) return fromDoc;
  return (carried ?? [])
    .filter((j) => (j.title ?? "").trim() || (j.kind ?? "").trim())
    .map((j) => {
      const start = yearText(j.yearStarted, j.yearApprox);
      const end = yearText(j.yearEnded, j.endApprox);
      return {
        title: (j.title ?? "").trim() || (j.kind ?? "").trim(),
        company: "",
        dates: start && end ? `${start} - ${end}` : start || end,
      };
    });
}

// ---- The daily limit ------------------------------------------------------

/**
 * When the daily AI limit resets, in the person's own clock. Usage is counted
 * per UTC day, so the limit opens again at the next UTC midnight.
 */
export function limitResetLabel(now: Date = new Date(), timeZone?: string): string {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const opts = timeZone ? { timeZone } : {};
  const time = reset.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...opts });
  const day = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric", ...opts });
  return `${time} ${day(reset) === day(now) ? "today" : "tomorrow"}`;
}

/** "1:05" from a count of seconds. */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---- When the build fails -------------------------------------------------

export interface BuildFailure {
  /** "limit": the daily cap (no retry today). "retry": try again is safe. "back": the person has to change an answer first. */
  kind: "limit" | "retry" | "back";
  title: string;
  body: string;
}

/**
 * What the screen says when /api/analyze does not come back with results.
 * `cause` is the HTTP status, or what happened before one arrived.
 */
export function buildFailure(cause: number | "network" | "timeout" | "unreadable", now: Date = new Date()): BuildFailure {
  if (cause === 429) {
    return {
      kind: "limit",
      title: "Today's limit is used up",
      body: `You've hit today's limit for building with t.ROY. You can try again after ${limitResetLabel(now)}. Your answers stay in this browser until then, unless you clear this computer.`,
    };
  }
  if (cause === 413) {
    return {
      kind: "back",
      title: "That was too much to send at once",
      body: "Your answers are too long to send in one piece. Go back, shorten the longest one, and try again.",
    };
  }
  if (cause === "timeout" || cause === 504) {
    return {
      kind: "retry",
      title: "t.ROY took too long",
      body: "It didn't finish this time. Your answers are still here. Try again in a minute.",
    };
  }
  if (cause === "network") {
    return {
      kind: "retry",
      title: "Couldn't reach t.ROY",
      body: "Check that you're online, then try again. Your answers are still here.",
    };
  }
  return {
    kind: "retry",
    title: "Something went wrong on our end",
    body: "t.ROY couldn't finish building this time. It wasn't anything you did. Your answers are still here. Try again.",
  };
}
