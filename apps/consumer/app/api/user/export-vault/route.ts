/**
 * POST /api/user/export-vault
 *
 * Streams the signed-in user's decrypted vault documents as a single STORE-only
 * ZIP (no compression, dependency-free -- see packages/core/src/zipStore.ts).
 * The JSON manifest of the same inventory lives in /api/user/export-data under
 * the "vault" category; this route is the bytes.
 *
 * REAUTH CONTRACT: identical to /api/user/export-data and /api/user/delete-data
 * -- a valid session is not enough for a bulk download of every private document.
 * The POST body must carry:
 *   { confirm: true, password: "..." }              (password accounts)
 *   { confirm: true, typedConfirmation: "DELETE" }  (magic-link/OAuth-only)
 *
 * Each file inside the ZIP is named safely from its label + type; duplicate
 * names are disambiguated with a numeric suffix. Owner-exclusive throughout:
 * every decrypt re-checks owner_user_id.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
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
    if (body?.typedConfirmation !== "DELETE") {
      return NextResponse.json(
        { error: 'Type "DELETE" in typedConfirmation to confirm this download.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
  }

  try {
    const docs = await listVaultDocuments(userId);
    if (docs.length === 0) {
      return NextResponse.json(
        { error: "Your vault is empty -- there is nothing to download yet." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const entries: ZipEntry[] = [];
    const usedNames = new Set<string>();
    for (const doc of docs) {
      const decrypted = await getDecryptedObject({ ownerUserId: userId, key: doc.object_key });
      if (!decrypted) continue; // skip anything not decryptable / not owned
      let name = safeVaultFilename(doc.label, doc.mime_type, doc.original_filename);
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 2;
        while (usedNames.has(`${stem} (${n})${ext}`)) n++;
        name = `${stem} (${n})${ext}`;
      }
      usedNames.add(name);
      entries.push({ name, data: new Uint8Array(decrypted.buffer) });
    }

    if (entries.length === 0) {
      return NextResponse.json(
        { error: "Could not read your vault files. Please try again." },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const zip = createStoreZip(entries);
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zip.length),
        "Content-Disposition": 'attachment; filename="steel-man-vault.zip"',
        ...NO_STORE_HEADERS,
      },
    });
  } catch (err: any) {
    console.error("Vault export error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to download your vault. Please try again." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
