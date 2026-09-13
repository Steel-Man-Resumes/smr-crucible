"use client";

/**
 * CARRY CODE REDEMPTION -- the outside end of the wall crossing.
 *
 * A person writes a code down inside a facility, walks out with it on a piece
 * of paper, and types it here. This is the screen that makes that mean
 * something.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE SAME AS /mini-forge/import
 * ---------------------------------------------------------------------------
 * The existing 6-character import code is a POINTER: it identifies a row in
 * tablet_session and the server looks up a finished career plan. That path is
 * untouched by this file and keeps working exactly as it did.
 *
 * A carry code is a PAYLOAD. Nothing was ever sent to a server, because the
 * Forge Tablet package has no network capability at all. The code itself
 * carries the answers. So there is nothing to look up, no PIN to check, and no
 * database involved.
 *
 * It also means redemption restores their ANSWERS, not a finished plan -- the
 * plan does not exist yet, because the model lives out here. They come in the
 * front door of the Forge with everything already filled in and the AI does
 * the work it could never do inside the wall. That is the architecture doing
 * exactly what it was designed to do.
 *
 * ---------------------------------------------------------------------------
 * ENTIRELY CLIENT SIDE, ON PURPOSE
 * ---------------------------------------------------------------------------
 * The decode happens in the browser. No server action, no cookie, no logging.
 * The code never leaves the device, which keeps the promise the consent screen
 * made inside the facility: their answers are theirs, and redeeming them does
 * not hand them to us on the way through.
 *
 * The codec is a byte-identical copy of scorm/src/carry-code.js, and there is
 * a test in the SCORM suite that fails the build if the two ever drift. A
 * drifted decoder silently turns somebody's answers into different answers,
 * which is the one failure in this whole system that cannot be apologised for.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import CarryCode from "@/lib/carry-code.js";

type DecodeResult =
  | {
      ok: true;
      intake: Record<string, unknown>;
      jobs: Array<Record<string, unknown>>;
      credentials?: string[];
    }
  | { ok: false; error: string; message: string };

export default function CarryPage() {
  const router = useRouter();
  const { updateSession } = useForgeSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleRedeem() {
    setError(null);

    const result = (CarryCode as { decode: (c: string) => DecodeResult }).decode(code);

    if (!result.ok) {
      // The decoder writes its own messages and they are better than anything
      // this page could invent: it knows whether characters are missing, which
      // character is not in the alphabet, or whether the checksum failed.
      setError(result.message);
      return;
    }

    const intake = result.intake as {
      readiness_stage?: string;
      goals?: string[];
      challenges?: string[];
      work_type?: string;
      skills?: string[];
      state?: string;
    };
    const jobs = (result.jobs || []) as Array<{
      kind?: string;
      title?: string;
      year_started?: number | null;
      year_approx?: boolean;
      year_ended?: number | null;
      end_approx?: boolean;
    }>;

    // Version 3 codes carry the credentials as well. Version 1 and 2 codes do
    // not, and come back with an empty list rather than an absent field, so
    // nothing downstream has to know which version it is looking at.
    const credentials = (result.credentials || []) as string[];

    updateSession({
      readinessStage: intake.readiness_stage as
        | "precontemplation"
        | "contemplation"
        | "preparation"
        | "action"
        | undefined,
      goals: intake.goals,
      challenges: intake.challenges,
      preferences: {
        ...(intake.state ? { location: intake.state } : {}),
        ...(intake.work_type ? { workType: intake.work_type } : {}),
      },
      // Everything the code carried, kept whole. The work history skeleton has
      // no home in the existing session shape and it is the part that took the
      // longest to recover, so it is stored rather than dropped.
      carriedIn: {
        code: code.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        skills: intake.skills || [],
        credentials,
        jobs: jobs.map((j) => ({
          kind: String(j.kind || ""),
          title: String(j.title || ""),
          yearStarted: typeof j.year_started === "number" ? j.year_started : null,
          yearApprox: j.year_approx === true,
          // 0 is not a year. It is the flag for "still there", and it prints
          // as Present rather than as 1960.
          yearEnded: typeof j.year_ended === "number" ? j.year_ended : null,
          endApprox: j.end_approx === true,
        })),
      },
      lastPageVisited: "carry",
    });

    // Straight into the Forge. They answered the readiness question inside, so
    // they do not get asked it twice.
    router.push("/resume");
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold text-t-white">Enter your code</h1>
      <p className="mb-8 text-t-phos">
        The one you wrote down before you left. It picks up everything you already
        answered so you do not start over.
      </p>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-warm-300 bg-warm-100 p-4 text-foreground"
        >
          {error}
        </div>
      )}

      <label htmlFor="carry_code" className="mb-2 block text-sm font-medium text-t-white">
        Your code
      </label>
      <input
        type="text"
        id="carry_code"
        name="carry_code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        placeholder="72S6K-22VEJ-GWY"
        className="min-h-touch w-full rounded-lg border border-t-line bg-t-panel px-4 py-3 text-center font-mono text-xl uppercase text-t-white focus:outline-none focus:ring-2 focus:ring-t-amber"
      />
      <p className="mt-2 text-sm text-t-phos-dim">
        Dashes are optional. Codes never use the letter O, the letter I, the number
        zero, or the number one.
      </p>

      <button
        type="button"
        onClick={handleRedeem}
        className="min-h-touch mt-6 w-full rounded-lg bg-t-amber px-6 py-4 text-lg font-semibold text-t-bg transition-opacity hover:opacity-90"
      >
        Pick up where I left off
      </button>

      <p className="mt-6 text-sm text-t-phos-dim">
        Lost the code? You can answer the questions again from the start. It takes a
        few minutes and nothing is gone forever.
      </p>
    </div>
  );
}
