/**
 * Seed a Nonprofit Development resume MASTER (locked, per-lane baseline) for one
 * user. Idempotent -- safe to re-run: if the user already has a locked resume on
 * the "Nonprofit Development" lane, it does nothing.
 *
 * The lane is created through the REAL create path (createArtifact + lockBaseline),
 * so it behaves exactly like a baseline the user locked by hand: it shows in the
 * Library's "Masters" group and is offered by the tailor's "searching as" selector.
 *
 * NO personal data is hardcoded here. The source content is generic,
 * clearly-placeholder nonprofit-development professional material -- the point is
 * that the LANE exists and is correctly shaped, not to inject a real resume.
 *
 * Run (dev only -- do NOT run against prod):
 *   TARGET_USER_ID=<uuid> DATABASE_URL=... npx tsx packages/core/scripts/seed-nonprofit-lane.ts
 *   # or resolve by email:
 *   TARGET_EMAIL=you@example.com DATABASE_URL=... npx tsx packages/core/scripts/seed-nonprofit-lane.ts
 */

import { query, getOne } from "../src/db";
import { createArtifact, lockBaseline } from "../src/refineryArtifact";

const LANE = "Nonprofit Development";

// Generic, obviously-placeholder nonprofit-development content. Not a real
// person. Shaped like a resume the Refinery understands (formatVersion envelope).
const NONPROFIT_CONTENT = {
  formatVersion: 2,
  meta: { createdFrom: "seed", lane: LANE, sample: true },
  name: "SAMPLE -- Nonprofit Development Professional",
  headline: "Development & Grants Professional",
  summary:
    "Sample nonprofit-development baseline. Fundraising, grant writing, donor stewardship, and program partnerships for mission-driven organizations. Replace this placeholder with your real experience.",
  skills: [
    "Grant writing",
    "Donor stewardship",
    "Program development",
    "Community partnerships",
    "Volunteer coordination",
    "Budget management",
  ],
  experience: [
    {
      title: "Development Coordinator",
      org: "Sample Community Organization",
      dates: "Placeholder -- Present",
      bullets: [
        "Sample bullet: secured grant funding to sustain core programs.",
        "Sample bullet: built and stewarded a base of recurring donors.",
        "Sample bullet: coordinated volunteers and community partners around program goals.",
      ],
    },
  ],
  education: [
    { credential: "Sample credential", org: "Sample institution", dates: "Placeholder" },
  ],
};

async function resolveUserId(): Promise<string> {
  const byId = process.env.TARGET_USER_ID?.trim();
  if (byId) {
    const row = await getOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [byId]);
    if (!row) throw new Error(`No user with id ${byId}`);
    return row.id;
  }
  const byEmail = process.env.TARGET_EMAIL?.trim();
  if (byEmail) {
    const row = await getOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [byEmail]);
    if (!row) throw new Error(`No user with email ${byEmail}`);
    return row.id;
  }
  throw new Error("Set TARGET_USER_ID or TARGET_EMAIL");
}

async function main() {
  const userId = await resolveUserId();

  // Idempotency: a locked resume already on this lane means we are done.
  const existing = await getOne<{ id: string }>(
    `SELECT id FROM refinery_artifact
      WHERE user_id = $1 AND artifact_type = 'resume' AND is_locked = true AND lane = $2
      LIMIT 1`,
    [userId, LANE]
  );
  if (existing) {
    console.log(`Nonprofit Development lane already exists for ${userId} (artifact ${existing.id}). Nothing to do.`);
    return;
  }

  const artifact = await createArtifact(
    userId,
    "resume",
    { source: "seed", lane: LANE, sample: true },
    NONPROFIT_CONTENT,
    1.0
  );
  const locked = await lockBaseline(userId, artifact.id, LANE);
  if (!locked) throw new Error(`lockBaseline failed for artifact ${artifact.id}`);

  console.log(`Created + locked Nonprofit Development baseline ${artifact.id} for user ${userId}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
