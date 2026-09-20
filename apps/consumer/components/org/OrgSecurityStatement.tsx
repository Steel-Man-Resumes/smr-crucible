"use client";

/**
 * <OrgSecurityStatement> -- what an organization is actually agreeing to.
 *
 * WRITTEN TO SURVIVE THE SECOND QUESTION. Anyone can write a reassuring
 * security page; the test is whether it holds up when a procurement officer or
 * a corrections IT lead asks "and how do you know that?" So every claim here is
 * one we can point at code or a test for, and the things we do NOT have are
 * stated as plainly as the things we do.
 *
 * That is not modesty. An organization that later discovers an unstated gap
 * stops believing the stated parts too, and this audience -- agencies handling
 * criminal-history data for people whose employment depends on it -- is
 * entirely right to check.
 *
 * Rules for editing this file:
 *   - No claim without a mechanism. "Secure" is not a mechanism.
 *   - Never say HIPAA-compliant, SOC 2 certified, or FedRAMP. We are none of
 *     those and borrowing a vendor's certification is not having one.
 *   - When something changes in the product, change it here in the same commit.
 *     A stale security page is worse than none.
 */

import { useState } from "react";

interface Item {
  q: string;
  a: string;
  /** How someone could check it, not just take our word. */
  proof?: string;
}

const SECTIONS: Array<{ heading: string; items: Item[] }> = [
  {
    heading: "Who can see your people",
    items: [
      {
        q: "Can another organization see our participants?",
        a: "No. Every query that touches participant data is scoped to the organization the signed-in person belongs to, and that membership is read from the database on every request rather than from their login session -- so removing someone takes effect on their next click, not whenever their session happens to expire.",
        proof:
          "A 13-assertion suite runs against a real database and tries to break it: reading another org's cohort, writing to another org's staff, claiming another org's participant. It has to pass before this ships.",
      },
      {
        q: "Can one of our case managers see another case manager's caseload?",
        a: "Only if you give them that access. A staff member sees the participants assigned to them and nobody else. An org admin sees everyone in your organization. That is the default, and it is deliberately the narrower one.",
      },
      {
        q: "Can Steel Man staff see our data?",
        a: "Yes, and you should assume so of any hosted product -- someone has to be able to fix a broken account. What matters is the constraints. Support access is read-only, expires in under an hour, and both entering and leaving it are written to an audit log. Permission is re-checked against the database on every single request, so revoking it ends an active session immediately.",
      },
    ],
  },
  {
    heading: "What the participant controls",
    items: [
      {
        q: "Do we see everything a participant does?",
        a: "No, and this is the part most tools get wrong. A participant chooses whether to share progress with your organization. If they decline, you see that they joined and nothing else -- they are counted, never named. That choice is theirs to change at any time.",
      },
      {
        q: "Do we see their resume, their practice sessions, their disclosure plan?",
        a: "No. You see progress signals: what stage they are at, how recently they were active, how many applications, whether they started work. Never the content. Their resume text, interview practice and disclosure planning are theirs.",
      },
    ],
  },
  {
    heading: "Artificial intelligence",
    items: [
      {
        q: "Which AI companies see this data?",
        a: "Two. Anthropic writes and coaches. OpenAI runs a smaller model that fact-checks what the first one wrote. Neither trains on your data. Voice practice, if used, streams audio to OpenAI who hold it up to 30 days for abuse monitoring.",
      },
      {
        q: "Can the assistant tell a case manager something that is not true?",
        a: "It is checked before they see it, in two passes. The first is arithmetic and identity: every number in the answer must be one the system actually computed, and every person named must be someone that viewer is permitted to see. That check involves no AI at all, so it cannot fail when a model is unavailable. The second is a different model re-reading the answer for claims the first cannot catch.",
        proof:
          "If either check cannot support something, the answer says so in the message rather than quietly rewriting it, and points back at your dashboard as the system of record.",
      },
      {
        q: "Does it ever invent a participant, or discuss one we cannot see?",
        a: "The identity check is specifically designed to stop that. A name outside the viewer's access is caught before the message is displayed.",
      },
    ],
  },
  {
    heading: "The data itself",
    items: [
      {
        q: "Where does it live, and is it encrypted?",
        a: "PostgreSQL on Neon, encrypted at rest, TLS in transit. Files in Cloudflare R2, encrypted at rest. Passwords are bcrypt hashes at 12 rounds -- we cannot read them and neither can anyone who steals the database.",
      },
      {
        q: "Can a participant take their data with them, or delete it?",
        a: "Both, without asking anyone. Full export of everything held about them, and a delete that either clears their data or removes the account entirely. Both require re-authentication.",
      },
      {
        q: "Is there a record of what the AI did?",
        a: "Every AI call is logged with the model, the input hash, and how long it took. If someone needs to reconstruct why a document said what it said, that record exists.",
      },
    ],
  },
  {
    heading: "What we do not have",
    items: [
      {
        q: "Are you HIPAA compliant?",
        a: "No, and you should not use this for protected health information. We are a career tool. If your program needs a BAA, that is a conversation to have before you start, not after.",
      },
      {
        q: "Are you SOC 2 certified?",
        a: "No. Our hosting and AI vendors are, and that is theirs rather than ours -- borrowing a vendor's certificate is not holding one. If your procurement requires SOC 2 from us, we do not meet it today and we will say so in writing.",
      },
      {
        q: "Is isolation enforced by the database itself?",
        a: "Not yet, and this is the honest one. Today one organization cannot see another because every query is scoped in application code, and a test suite verifies that against a real database. Database-level row security is being added as a second layer beneath it. Until that lands, the guarantee rests on code plus tests rather than code plus tests plus the database refusing.",
      },
    ],
  },
];

export function OrgSecurityStatement() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-t-white">Security and privacy</h1>
      <p className="mt-2 text-sm leading-relaxed text-t-phos-dim">
        Written for the person who has to answer for this internally. Every
        claim below is one we can point at a mechanism for, and the last section
        is what we do not have -- because finding that out later is how you stop
        believing the rest.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="mt-7">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-t-amber-bright">
            {section.heading}
          </h2>
          <div className="border border-t-line bg-t-panel">
            {section.items.map((item) => {
              const isOpen = open === item.q;
              return (
                <div key={item.q} className="border-b border-t-line last:border-b-0">
                  <button
                    onClick={() => setOpen(isOpen ? null : item.q)}
                    className="t-focus flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="text-sm font-medium text-t-white">{item.q}</span>
                    <span aria-hidden="true" className="mt-0.5 text-[10px] text-t-phos-dim">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3">
                      <p className="text-sm leading-relaxed text-t-phos">{item.a}</p>
                      {item.proof && (
                        <p className="mt-2 border-l-2 border-t-line pl-3 text-xs leading-relaxed text-t-phos-dim">
                          <strong className="text-t-phos">How you can check:</strong>{" "}
                          {item.proof}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="mt-8 border-t border-t-line pt-4 text-xs leading-relaxed text-t-phos-dim">
        If something here is not enough for your procurement process, say so and
        we will tell you plainly whether we can meet it, when, or not at all.
        A requirement we cannot meet is better discovered now.
      </p>
    </div>
  );
}
