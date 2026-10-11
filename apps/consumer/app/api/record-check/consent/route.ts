/**
 * /api/record-check/consent -- the record check's own yes (D11).
 *   GET    -> is the current yes in place (and is this a staff session)
 *   POST   -> { ticked: true, textVersion } records the yes with a timestamp
 *   DELETE -> takes the yes back and deletes every saved record check
 * Staff acting as the person (impersonation, any mode) can do none of these.
 * Writes must be same-origin JSON; every call needs the person's tier.
 * The general /api/consent route cannot grant this layer (not toggleable).
 */
import {
  handleConsentDelete,
  handleConsentGet,
  handleConsentPost,
} from "@/lib/record-check/handler";
import { realRecordCheckDeps } from "@/lib/record-check/deps";
import { recordStepOn, switchedOffResponse } from "@/lib/server-switch";

export const dynamic = "force-dynamic";

// Every method answers 404 while the step is off (lib/server-switch.ts).

export async function GET(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleConsentGet(request, realRecordCheckDeps());
}

export async function POST(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleConsentPost(request, realRecordCheckDeps());
}

export async function DELETE(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return handleConsentDelete(request, realRecordCheckDeps());
}
