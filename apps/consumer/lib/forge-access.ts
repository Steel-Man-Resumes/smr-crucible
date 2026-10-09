/**
 * Who may use which part of the Forge, and from when.
 *
 * THE WALL. The Forge's question and build screens move behind sign-in (one
 * free account, the same one the Refinery uses). The public pages, the free
 * checker and the Mini Forge stay open. The wall goes up on a date the owner
 * sets in FORGE_SIGN_IN_STARTS_AT; until that date the Forge works as it
 * always has and the public pages show a quiet notice with the date.
 *
 * Pure and edge-safe (no imports): the middleware, the route wrappers, the
 * client pages and the unit tests all read the same rules.
 */

/**
 * When the Forge starts asking people to sign in. SET BY THE OWNER, never by
 * code or an agent: an ISO 8601 instant with its offset, for example
 * "2026-11-02T00:00:00-07:00" (midnight Mountain Time). null means no date has
 * been set: no notice is shown and the wall stays down (unless the
 * NEXT_PUBLIC_FORGE_SIGN_IN_WALL switch below says otherwise).
 */
export const FORGE_SIGN_IN_STARTS_AT: string | null = null;

/**
 * Deployment switch, read at build time (NEXT_PUBLIC_, so the browser and the
 * middleware agree):
 *   "on"  the wall is up now, whatever the date (preview testing);
 *   "off" the wall is down and no notice shows (an emergency off switch);
 *   unset the date above decides.
 */
export const FORGE_WALL_ENV = "NEXT_PUBLIC_FORGE_SIGN_IN_WALL";

/**
 *  - "open":      no date set (or switched off): the Forge works signed out;
 *  - "announced": a date is set and still ahead: works signed out, notice shows;
 *  - "up":        the date has come (or switched on): Forge screens need sign-in.
 */
export type ForgeWall = "open" | "announced" | "up";

/*
 * A DATE OR SWITCH THAT CANNOT BE READ LEAVES THE WALL DOWN (security review
 * 3a r1, L1). Down is how the Forge works today, so a typo can never lock
 * people out of it by surprise; the cost is that a typo does not put the wall
 * up. Two guards cover that side: a unit test fails the build when the date in
 * this file is set but unreadable (forge-wall.test.ts), and the server logs a
 * clear warning (once per process) when it meets an unreadable date or switch.
 * "Unreadable" includes impossible calendar dates (February 30), a missing
 * time, and a missing offset: nothing is guessed.
 */

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  if (typeof console !== "undefined") console.warn(`[forge-wall] ${message}`);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/** The instant the wall goes up, or null when the value is missing or unreadable (never a guess). */
export function forgeWallStartsAt(startsAt: string | null | undefined = FORGE_SIGN_IN_STARTS_AT): number | null {
  if (typeof startsAt !== "string" || !startsAt.trim()) return null;
  const m = DATE_RE.exec(startsAt.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return null;
  // The day must exist in that month (no February 30, no April 31).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (m[8]) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 14 || om > 59) return null;
  }
  const t = Date.parse(startsAt.trim());
  return Number.isFinite(t) ? t : null;
}

/** The switch as written, read leniently ("ON", " on "); anything else is unset. */
export function readWallSwitch(raw: string | null | undefined): "on" | "off" | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "on" || v === "off") return v;
  if (v) warnOnce(`${FORGE_WALL_ENV}="${raw}" is not "on" or "off"; ignored, the date decides.`);
  return null;
}

export function forgeWallState(
  opts: { now?: number; startsAt?: string | null; override?: string | null } = {}
): ForgeWall {
  const override = readWallSwitch(
    opts.override !== undefined
      ? opts.override
      : (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FORGE_SIGN_IN_WALL : undefined) ?? null
  );
  if (override === "on") return "up";
  if (override === "off") return "open";
  const raw = opts.startsAt === undefined ? FORGE_SIGN_IN_STARTS_AT : opts.startsAt;
  const at = forgeWallStartsAt(raw);
  if (at === null) {
    if (typeof raw === "string" && raw.trim()) {
      warnOnce(`FORGE_SIGN_IN_STARTS_AT "${raw}" is not a readable date and time with an offset; the wall stays down.`);
    }
    return "open";
  }
  return (opts.now ?? Date.now()) >= at ? "up" : "announced";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The date as people read it ("November 2"), taken from the date the owner
 * typed, not from any time zone conversion, so it never shifts by a day.
 */
export function forgeWallDateLabel(startsAt: string | null | undefined = FORGE_SIGN_IN_STARTS_AT): string | null {
  if (forgeWallStartsAt(startsAt) === null) return null;
  const [, m, d] = (startsAt as string).trim().slice(0, 10).split("-").map(Number);
  if (!m || !d || m > 12) return null;
  return `${MONTHS[m - 1]} ${d}`;
}

/** The notice for current users. Shown only while the wall is announced. */
export function forgeWallNotice(wall: ForgeWall, startsAt: string | null | undefined = FORGE_SIGN_IN_STARTS_AT): string | null {
  if (wall !== "announced") return null;
  const date = forgeWallDateLabel(startsAt);
  if (!date) return null;
  return `Starting ${date}, the Forge asks you to sign in. It's still free. Your saved work comes with you.`;
}

/* ------------------------------------------------------------------ pages -- */

/**
 * Forge pages that stay public when the wall is up. /check is the free
 * checker. Every /mini-forge path is public too (the tablets in facilities
 * have no accounts); it is outside the Forge shell and the middleware matcher.
 */
export const FORGE_PUBLIC_PAGES = ["/intro", "/overview", "/partner", "/get-listed", "/security", "/check"] as const;

/**
 * The Forge question and build screens. Each needs a signed-in, fully
 * verified session once the wall is up. Exact paths (the Forge has no nested
 * routes). Keep in step with the matcher in middleware.ts (a test checks).
 */
export const FORGE_SIGN_IN_PAGES = [
  "/welcome",
  "/resume",
  "/goals",
  "/story",
  "/preferences",
  "/processing",
  "/output",
  "/rush",
  "/carry",
] as const;

export function isForgeSignInPage(path: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return (FORGE_SIGN_IN_PAGES as readonly string[]).includes(p);
}

export function isMiniForgePath(path: string): boolean {
  return path === "/mini-forge" || path.startsWith("/mini-forge/");
}

/* ------------------------------------------------------------------- APIs -- */

/**
 * The Forge's API routes that keep working with no session after the wall
 * goes up. Exact paths, each with the reason it is open. Everything else the
 * Forge calls needs the session. The Mini Forge needs none of these: it runs
 * on server pages and its own route (/mini-forge/import-complete), outside
 * /api and outside the middleware matcher.
 */
export const FORGE_SIGNED_OUT_API_ALLOWLIST: Readonly<Record<string, string>> = {
  "/api/assistant":
    "t.ROY's chat on the public pages (intro, overview, partner, the free checker) answers questions before anyone signs in. Per-IP daily limit; a signed-out caller reaches no account data.",
  "/api/resume/layout":
    "Page fit for the free checker: lays the pasted text out with the real resume fonts and returns a page count. No AI call, nothing stored, per-IP daily limit.",
  "/api/check/extract":
    "File upload for the free checker: reads the text out of the file and says whether a machine could read it. No AI call, nothing stored, per-IP daily limit.",
  "/api/org-listing":
    "The public form on /get-listed where an organization asks to be listed. No AI call; per-IP daily limit.",
};

export function isForgeSignedOutApi(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(FORGE_SIGNED_OUT_API_ALLOWLIST, path);
}

/** Where a signed-out person goes from a Forge screen: sign-in, then straight back. */
export function forgeSignInUrl(pathWithSearch: string): string {
  return "/login?from=forge&callbackUrl=" + encodeURIComponent(pathWithSearch);
}

/** The plain message a signed-out call to a walled Forge API gets. */
export const FORGE_SIGN_IN_REQUIRED_MESSAGE = "Sign in to use the Forge. It's free.";
