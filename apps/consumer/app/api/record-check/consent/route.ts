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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleConsentGet(request, realRecordCheckDeps());
}

export async function POST(request: Request) {
  return handleConsentPost(request, realRecordCheckDeps());
}

export async function DELETE(request: Request) {
  return handleConsentDelete(request, realRecordCheckDeps());
}
