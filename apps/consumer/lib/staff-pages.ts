/**
 * The staff pages t.ROY may open a button to (lane S1, staff pass 2026-10-27).
 *
 * THE RULES
 *  - A fixed allowlist. The model names a page KEY from this table, never a
 *    URL; the chat turns the key into the href from this same table.
 *  - A page is open to someone only when their own sidebar shows it: the
 *    allowlist is filtered through orgNavFor (lib/org-nav.ts) with their
 *    capabilities and their organization's module switches. Settings and Help
 *    are on every seat's screen, so they are always open.
 *  - A key whose href is not in anyone's nav yet (Directory, My setup, Inbox
 *    from other lanes) stays closed until that nav entry lands. Nothing here
 *    widens what a role can reach: the page itself still checks.
 *  - t.ROY never moves the screen. He shows a "Go to" button; the staff
 *    member presses it.
 *
 * Pure and browser-safe: the chat and the server tool both import it.
 */
import { orgNavFor } from "./org-nav";

export interface StaffPage {
  key: string;
  href: string;
  /** Button words: "Go to {label}". */
  label: string;
  /** Plain words for the model: what the page is for. */
  about: string;
  /** Open whatever the nav says (Settings, Help). */
  always?: boolean;
}

export const STAFF_PAGES: readonly StaffPage[] = [
  { key: "today", href: "/dashboard/today", label: "Today", about: "who needs them today and why" },
  { key: "people", href: "/dashboard/people", label: "People", about: "everyone on their list, as a table" },
  { key: "find-a-person", href: "/dashboard/search", label: "Find a person", about: "search by name, email, phone or program id" },
  { key: "asks", href: "/dashboard/requests", label: "Asks", about: "requests to share that are waiting" },
  { key: "referrals", href: "/dashboard/referrals", label: "Referrals", about: "referrals sent and what came back" },
  { key: "case-notes", href: "/dashboard/notes", label: "Case notes", about: "notes across their people" },
  { key: "add-people", href: "/dashboard/participants", label: "Add people", about: "invite someone new by name and email" },
  { key: "insights", href: "/dashboard/insights", label: "Insights", about: "placements, retention and program numbers" },
  { key: "activity-log", href: "/dashboard/audit", label: "Activity log", about: "who changed what, and when" },
  { key: "team", href: "/dashboard/team", label: "Team & access", about: "staff, roles and invites" },
  { key: "sharing-policy", href: "/dashboard/sharing-policy", label: "Sharing policy", about: "what staff may ask people to share" },
  { key: "security", href: "/dashboard/org-security", label: "Security & privacy", about: "how the organization's data is protected" },
  { key: "structure", href: "/dashboard/structure", label: "Structure", about: "programs, sites, teams and caseloads" },
  { key: "set-up", href: "/dashboard/setup", label: "Set up", about: "the organization's first-run setup" },
  { key: "fields", href: "/dashboard/fields", label: "Fields", about: "the organization's own fields" },
  { key: "layouts", href: "/dashboard/layouts", label: "Layouts", about: "what each role sees first" },
  // Other lanes' pages (staff pass 2026-10-27). Closed until their nav entry lands.
  { key: "directory", href: "/dashboard/directory", label: "Directory", about: "local help and employers that hire people with records" },
  { key: "employers", href: "/dashboard/employers", label: "Employers", about: "employers that hire people with records, with the date we checked" },
  { key: "local-help", href: "/dashboard/resources", label: "Local help", about: "the help directory by place and need" },
  { key: "my-setup", href: "/dashboard/my-setup", label: "My setup", about: "their own view, columns, suggestions and rewards" },
  { key: "inbox", href: "/dashboard/inbox", label: "Inbox", about: "mentions, tasks given to them and answers" },
  // On every seat's screen (the shell's foot).
  { key: "settings", href: "/dashboard/settings", label: "Settings", about: "their account, sign-in and workflow choices", always: true },
  { key: "help", href: "/dashboard/help", label: "Help", about: "how the workspace works, and the tour", always: true },
];

export const STAFF_PAGE_KEYS: readonly string[] = STAFF_PAGES.map((p) => p.key);

/** A person's own page: opened by id, only for someone on their list. */
export const PERSON_PAGE_KEY = "person";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function staffPage(key: unknown): StaffPage | null {
  return typeof key === "string" ? STAFF_PAGES.find((p) => p.key === key) ?? null : null;
}

/**
 * The pages this person may be sent to: what their sidebar shows, plus the
 * always-open ones. Same inputs as the sidebar, so the two cannot disagree.
 */
export function staffPagesFor(capabilities: Iterable<string>, modules?: Readonly<Record<string, boolean>> | null): StaffPage[] {
  const hrefs = new Set(orgNavFor([...capabilities], modules ?? null).flatMap((g) => g.items.map((i) => i.href)));
  return STAFF_PAGES.filter((p) => p.always || hrefs.has(p.href));
}

/** The href for a tool result: the chat's own table, never text from the model. Null when unknown. */
export function staffPageHref(key: unknown, clientId?: unknown): string | null {
  if (key === PERSON_PAGE_KEY) return typeof clientId === "string" && UUID.test(clientId) ? `/dashboard/clients/${clientId.toLowerCase()}` : null;
  return staffPage(key)?.href ?? null;
}

/** Button words for a key. */
export function staffPageLabel(key: unknown, firstName?: string | null): string {
  if (key === PERSON_PAGE_KEY) {
    const first = (firstName ?? "").trim().split(/\s+/)[0];
    return first ? `${first}'s page` : "their page";
  }
  return staffPage(key)?.label ?? "that page";
}

/** Every word in a page label, lowercased: the answer check treats these as screen names, not people. */
export const STAFF_PAGE_WORDS: ReadonlySet<string> = new Set(
  STAFF_PAGES.flatMap((p) => p.label.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 1),
);
