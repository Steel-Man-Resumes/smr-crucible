/**
 * POST /api/user/export-vault
 *
 * Returns the signed-in user's decrypted vault documents as a single STORE-only
 * ZIP (no compression, dependency-free; see packages/core/src/zipStore.ts),
 * built in memory and sent as one response. The JSON manifest of the same
 * inventory lives in /api/user/export-data under the "vault" category; this
 * route is the bytes.
 *
 * SIZE: one response body is capped near 4.5 MB on the platform, so the stored
 * sizes are summed first and anything over VAULT_ZIP_MAX_BYTES (lib/export-plan.ts)
 * gets a 413 that says to download fewer documents at a time. A file that
 * cannot be decrypted is counted and named in SKIPPED.txt inside the ZIP, never
 * dropped silently. Streaming or a stored ZIP with a short-lived link is a
 * later lane.
 *
 * AUTH: effectiveAuth() plus the "private" Settings refusal (lib/settings-guard.ts):
 * any impersonation, view or assist, gets a 403 before anything is read. (This
 * was the non-impersonatable auth(); the refusal gives the same protection
 * and says why.)
 *
 * REAUTH CONTRACT: identical to /api/user/export-data -- a valid session is
 * not enough for a bulk download of every private document. The POST body
 * must carry:
 *   { confirm: true, password: "..." }   (password accounts)
 *   { confirm: true, ownDevice: true }   (magic-link/OAuth-only: the plain
 *                                         confirm under the shared-computer
 *                                         warning; DELETE is the delete word)
 *
 * Each file inside the ZIP is named safely from its label + type; duplicate
 * names are disambiguated with a numeric suffix. Owner-exclusive throughout:
 * every decrypt re-checks owner_user_id.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { checkAuthRateLimits, getClientIp, reauthRateLimits } from "@/lib/auth-rate-limit";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { noPasswordExportConfirmed, vaultZipPlan, VAULT_ZIP_MAX_BYTES, VAULT_ZIP_TOO_LARGE, SKIPPED_FILE_NAME, skippedFilesNote } from "@/lib/export-plan";
import {
  getOne,
  listVaultDocuments,
  getDecryptedObject,
  createStoreZip,
  safeVaultFilename,
  type ZipEntry,
} from "@crucible/core";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export async function POST(req: Request) {
  const session = await auth();
  { const refused = settingsRefusal(session, "private", "write"); if (refused) return refused; }
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Set confirm: true to acknowledge this downloads all your vault files." },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  // Reauth gate -- same contract as export-data / delete-data.
  // Password re-check is rate limited (F7): it was a free password oracle
  // for anyone holding a session.
  const reauthLimit = await checkAuthRateLimits(reauthRateLimits(getClientIp(req), userId));
  if (!reauthLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429, headers: NO_STORE_HEADERS }
    );
  }

  const account = await getOne<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId]
  );
  if (account?.password_hash) {
    const password = typeof body?.password === "string" ? body.password : "";
    const valid = password && (await bcrypt.compare(password, account.password_hash));
    if (!valid) {
      return NextResponse.json(
        { error: "Enter your password to confirm this download." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
  } else {
    // No password to re-enter: a plain confirm, the own-device tick that sits
    // under the shared-computer warning (lib/export-plan.ts). Typing DELETE is
    // for deleting; it no longer exports anything (TOOL-REVISIONS S8).
    if (!noPasswordExportConfirmed(body)) {
      return NextResponse.json(
        { error: 'Tick "This is my own phone or computer" to confirm this download.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
  }

  try {
    const docs = await listVaultDocuments(userId);
    if (docs.length === 0) {
      return NextResponse.json(
        { error: "Your vault is empty. There is nothing to download yet." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    // Too big for one response: say so before decrypting a single file.
    if (vaultZipPlan(docs.map((d) => Number(d.byte_size))).over) {
      return NextResponse.json({ error: VAULT_ZIP_TOO_LARGE }, { status: 413, headers: NO_STORE_HEADERS });
    }

    const entries: ZipEntry[] = [];
    const usedNames = new Set<string>([SKIPPED_FILE_NAME]);
    const skipped: string[] = [];
    const uniqueName = (wanted: string) => {
      let name = wanted;
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 2;
        while (usedNames.has(`${stem} (${n})${ext}`)) n++;
        name = `${stem} (${n})${ext}`;
      }
      usedNames.add(name);
      return name;
    };
    for (const doc of docs) {
      const name = uniqueName(safeVaultFilename(doc.label, doc.mime_type, doc.original_filename));
      const decrypted = await getDecryptedObject({ ownerUserId: userId, key: doc.object_key });
      if (!decrypted) { skipped.push(name); continue; } // not decryptable / not owned: named in SKIPPED.txt
      entries.push({ name, data: new Uint8Array(decrypted.buffer) });
    }
    if (skipped.length === docs.length) {
      // Nothing could be read: no ZIP of one note.
      return NextResponse.json(
        { error: "None of your files could be read right now. They are still in Private records and documents. Try again in a moment." },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }
    if (skipped.length) {
      entries.push({ name: SKIPPED_FILE_NAME, data: new TextEncoder().encode(skippedFilesNote(skipped.length, skipped)) });
    }

    const zip = createStoreZip(entries);
    if (zip.length > VAULT_ZIP_MAX_BYTES) {
      return NextResponse.json({ error: VAULT_ZIP_TOO_LARGE }, { status: 413, headers: NO_STORE_HEADERS });
    }
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zip.length),
        "Content-Disposition": 'attachment; filename="steel-man-documents.zip"',
        ...NO_STORE_HEADERS,
      },
    });
  } catch (err: any) {
    console.error("Vault export error:", err?.message || err);
    return NextResponse.json(
      { error: "Your documents could not be downloaded right now. They are still in Private records and documents." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
