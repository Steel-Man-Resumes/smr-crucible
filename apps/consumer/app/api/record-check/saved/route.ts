/**
 * /api/record-check/saved -- checklists the person chose to save (D11).
 *   GET    -> their saved checklists (no typed text); ?id= opens one, with
 *             what they typed only where they kept it
 *   POST   -> "Save this checklist": the state and picked ids; the job and the
 *             record only with keepTyped. Capped at 50 per person.
 *   DELETE -> ?id= deletes one
 * Owner only (the saved table is row-level protected). Staff sessions are
 * refused. Nothing here is shared with a program.
 */
import {
  handleSavedDelete,
  handleSavedGet,
  handleSavedPost,
} from "@/lib/record-check/handler";
import { realRecordCheckDeps } from "@/lib/record-check/deps";
import { recordStepOn, switchedOffResponse } from "@/lib/server-switch";

export const dynamic = "force-dynamic";

// GET and POST answer 404 while the step is off (lib/server-switch.ts).

export async function GET(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleSavedGet(request, realRecordCheckDeps());
}

export async function POST(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleSavedPost(request, realRecordCheckDeps());
}

// WITHDRAWAL ALWAYS WORKS (review L4): DELETE stays open while the step is
// switched off. It only removes the person's own data and calls no AI; the
// handler still requires the owner's session and same-origin JSON, and
// refuses staff acting as the person.
export async function DELETE(request: Request) {
  return handleSavedDelete(request, realRecordCheckDeps());
}
