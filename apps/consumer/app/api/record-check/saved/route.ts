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

// Every method answers 404 while the step is off (lib/server-switch.ts).

export async function GET(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleSavedGet(request, realRecordCheckDeps());
}

export async function POST(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleSavedPost(request, realRecordCheckDeps());
}

export async function DELETE(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleSavedDelete(request, realRecordCheckDeps());
}
