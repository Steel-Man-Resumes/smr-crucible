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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSavedGet(request, realRecordCheckDeps());
}

export async function POST(request: Request) {
  return handleSavedPost(request, realRecordCheckDeps());
}

export async function DELETE(request: Request) {
  return handleSavedDelete(request, realRecordCheckDeps());
}
