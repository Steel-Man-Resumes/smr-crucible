/**
 * /api/record-check/saved -- checklists the person chose to save (D11).
 *   GET    -> their saved checklists (the offense only where they kept it)
 *   POST   -> "Save this checklist"; the offense is kept only with keepOffense
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

export async function GET() {
  return handleSavedGet(realRecordCheckDeps());
}

export async function POST(request: Request) {
  return handleSavedPost(request, realRecordCheckDeps());
}

export async function DELETE(request: Request) {
  return handleSavedDelete(request, realRecordCheckDeps());
}
