#!/usr/bin/env node
/**
 * Release check from the command line (the same check next.config.mjs runs at
 * the start of every `next build`). Exits 1 when it fails.
 *
 *   SMR_RELEASE_REQUIRES_ACCOUNTS=1 NEXT_PUBLIC_FORGE_SIGN_IN_WALL=on \
 *     node apps/consumer/scripts/release-check.mjs
 *
 * See lib/release-check.mjs and docs/SHIP-DAY-GATES.md.
 */
import { releaseCheck, formatReleaseCheck } from "../lib/release-check.mjs";

const result = releaseCheck(process.env);
const text = formatReleaseCheck(result);
if (result.ok) {
  console.log(text);
} else {
  console.error(text);
  process.exit(1);
}
