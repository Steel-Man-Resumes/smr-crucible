"use client";

/**
 * <AccountTypeChooser> -- "who are you here as?"
 *
 * Four kinds of people arrive at this page and they want four different
 * things. Previously they all got one form and a paragraph of small print
 * explaining which parts applied to them, which is the reading comprehension
 * test nobody wants at a sign-in screen.
 *
 * ONE HONEST DESIGN CONSTRAINT SHAPES ALL OF THIS. These are NOT separate
 * systems, separate portals, or separate logins -- it is one account model, and
 * pretending otherwise would be theatre that falls apart the moment someone
 * holds two roles. What actually differs is where you land, what you need in
 * hand before you start, and whether self-serve is even the right answer.
 *
 * Which is why the agency option does not offer a signup form. A state agency
 * evaluating this does not want an account, they want to see whether it does
 * what we say and what it would take to run it. Sending them to a password
 * field would be the wrong answer dressed as a convenience.
 *
 * ONE PERSON, MORE THAN ONE ACCOUNT is normal here, not an edge case: a
 * reentry case manager who is also rebuilding their own career is exactly the
 * person this product exists for. So the choice is framed as a route, never as
 * an identity, and nothing here locks anyone out of the other doors.
 */

import type { ReactNode } from "react";

export type AccountRoute = "seeker" | "participant" | "org" | "agency";

interface RouteSpec {
  id: AccountRoute;
  label: string;
  /** Who this is, in their own terms, not ours. */
  blurb: string;
  /** The heading the form takes on once chosen. */
  heading: string;
  /** What they need before they start, when that is not "nothing". */
  needs?: string;
}

export const ACCOUNT_ROUTES: RouteSpec[] = [
  {
    id: "seeker",
    label: "I am looking for work",
    blurb: "Build a resume, practise interviews, find fair-chance employers.",
    heading: "Sign in to The Refinery",
  },
  {
    id: "participant",
    label: "My program sent me",
    blurb:
      "A reentry program, workforce board, or case manager gave you a code.",
    heading: "Sign in with your program",
    needs:
      "Have your program's access code ready. It unlocks the full toolset at no cost to you.",
  },
  {
    id: "org",
    label: "I work for an organization",
    blurb: "See how the people you support are doing, and step in when needed.",
    heading: "Sign in to your organization",
    needs:
      "Your organization's admin adds you to the team. If nobody has, ask them first -- signing up here creates a personal account instead.",
  },
  {
    id: "agency",
    label: "I am evaluating this for an agency",
    blurb: "Corrections, labor, vocational rehabilitation, or a funder.",
    heading: "Evaluating Steel Man Resumes",
    needs:
      "There is nothing to sign up for. The Forge runs free with no account, so the fastest way to judge this is to put a real resume through it.",
  },
];

export function AccountTypeChooser({
  value,
  onChange,
}: {
  value: AccountRoute;
  onChange: (next: AccountRoute) => void;
}) {
  return (
    <fieldset className="mb-6">
      <legend className="app-eyebrow mb-2 text-[#4f6b57]">
        Who are you here as?
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ACCOUNT_ROUTES.map((r) => {
          const selected = r.id === value;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange(r.id)}
              aria-pressed={selected}
              className={`t-focus min-h-touch rounded-[2px] border p-3 text-left transition-colors ${
                selected
                  ? "border-[#4f6b57] bg-[#f5f6f4]"
                  : "border-t-line bg-transparent hover:border-t-line-strong"
              }`}
            >
              <span className="block text-sm font-semibold text-t-white">
                {r.label}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-t-bone-dim">
                {r.blurb}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-t-bone-dim">
        Same sign-in either way -- this just decides where you land. Plenty of
        people here hold more than one of these, and you can switch any time.
      </p>
    </fieldset>
  );
}

/**
 * What the chosen route needs you to know before you start, if anything.
 * Rendered separately so the form can place it where it reads best.
 */
export function AccountRouteNote({
  route,
  children,
}: {
  route: AccountRoute;
  children?: ReactNode;
}) {
  const spec = ACCOUNT_ROUTES.find((r) => r.id === route);
  if (!spec?.needs) return null;
  return (
    <section className="mb-6 border-l-[3px] border-[#4f6b57] bg-[#f5f6f4] py-3 pl-4 pr-3">
      <p className="text-xs leading-relaxed text-t-bone-dim">{spec.needs}</p>
      {children}
    </section>
  );
}
