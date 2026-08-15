/**
 * Phase 6 vault + library -- pure adversarial tests (no DB).
 *
 * Covers: vault category validation, MIME allowlist + content-sniff (declared
 * vs sniffed mismatch), safe-filename traversal defense, the pure
 * library-grouping resolver + its SQL-predicate agreement, and the zipStore
 * CRC32 + STORE round-trip. DB-backed ownership/IDOR is exercised live by
 * scripts/verify-6-vault.mjs (a pure suite cannot touch R2/Postgres).
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VAULT_CATEGORIES,
  VAULT_MIME_ALLOWLIST,
  isVaultCategory,
  isAllowedVaultMime,
  normalizeMime,
  sniffVaultMime,
  decideVaultMime,
  safeVaultFilename,
  MAX_VAULT_FILE_BYTES,
} from "../vaultDocumentShared";
import {
  resolveResumeGroup,
  countResumeGroups,
  RESUME_GROUP_KEYS,
  isResumeGroup,
} from "../libraryGroupingShared";
import { RESUME_GROUP_PREDICATES } from "../refineryArtifact";
import { crc32, createStoreZip } from "../zipStore";

// --- category CHECK validation (mirrors the migration 042 CHECK) ---
test("vault category: the six categories are exactly the CHECK set", () => {
  const keys = VAULT_CATEGORIES.map((c) => c.key).sort();
  assert.deepEqual(keys, ["certificate", "id", "note", "other", "record", "reference_letter"]);
});

test("vault category: isVaultCategory accepts only known keys", () => {
  for (const c of VAULT_CATEGORIES) assert.ok(isVaultCategory(c.key));
  assert.equal(isVaultCategory("password"), false);
  assert.equal(isVaultCategory(""), false);
  assert.equal(isVaultCategory(null), false);
  assert.equal(isVaultCategory("ID"), false); // case-sensitive
});

// --- MIME allowlist + sniff ---
test("vault mime: allowlist covers real document types, not archives/executables", () => {
  assert.ok(isAllowedVaultMime("application/pdf"));
  assert.ok(isAllowedVaultMime("image/jpeg"));
  assert.ok(isAllowedVaultMime("image/png; charset=binary")); // parameters stripped
  assert.equal(isAllowedVaultMime("application/zip"), false);
  assert.equal(isAllowedVaultMime("application/x-msdownload"), false);
  assert.equal(isAllowedVaultMime(""), false);
  assert.equal(isAllowedVaultMime(null), false);
});

test("normalizeMime strips parameters and lowercases", () => {
  assert.equal(normalizeMime("IMAGE/JPEG; charset=x"), "image/jpeg");
  assert.equal(normalizeMime(undefined), "");
});

const PDF = Buffer.from("%PDF-1.4\n...", "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = Buffer.from("GIF89a....", "utf8");
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ" -- a PE header

test("sniffVaultMime detects binary signatures", () => {
  assert.equal(sniffVaultMime(PDF), "application/pdf");
  assert.equal(sniffVaultMime(PNG), "image/png");
  assert.equal(sniffVaultMime(JPEG), "image/jpeg");
  assert.equal(sniffVaultMime(GIF), "image/gif");
  assert.equal(sniffVaultMime(EXE), null);
});

test("decideVaultMime: honest uploads pass", () => {
  assert.deepEqual(decideVaultMime("application/pdf", PDF), { ok: true, mime: "application/pdf" });
  assert.deepEqual(decideVaultMime("image/png", PNG), { ok: true, mime: "image/png" });
});

test("decideVaultMime: a mislabeled file is rejected (declared != sniffed)", () => {
  // An attacker labels PNG bytes as a PDF, or PDF bytes as an image.
  const r1 = decideVaultMime("application/pdf", PNG);
  assert.equal(r1.ok, false);
  const r2 = decideVaultMime("image/png", PDF);
  assert.equal(r2.ok, false);
});

test("decideVaultMime: an executable disguised as an image is rejected (sniff fails)", () => {
  const r = decideVaultMime("image/png", EXE);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "content_type_unrecognized");
});

test("decideVaultMime: an unsupported declared type is rejected outright", () => {
  const r = decideVaultMime("application/zip", PDF);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unsupported_type");
});

test("decideVaultMime: text/doc/docx accepted on declared type (no reliable magic number)", () => {
  assert.equal(decideVaultMime("text/plain", Buffer.from("hello")).ok, true);
  assert.equal(
    decideVaultMime(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    ).ok,
    true
  );
});

test("MAX_VAULT_FILE_BYTES is 25 MB", () => {
  assert.equal(MAX_VAULT_FILE_BYTES, 25 * 1024 * 1024);
});

// --- safe filename (path traversal + control chars) ---
test("safeVaultFilename strips traversal and separators, keeps a real extension", () => {
  assert.equal(safeVaultFilename("../../etc/passwd", "application/pdf"), "etc passwd.pdf");
  assert.equal(safeVaultFilename("my id", "image/jpeg"), "my id.jpg");
  // Empty/garbage label falls back to a safe default.
  assert.equal(safeVaultFilename("///", "application/pdf"), "document.pdf");
  // No double extension.
  assert.equal(safeVaultFilename("resume.pdf", "application/pdf"), "resume.pdf");
});

// --- library grouping resolver + SQL-predicate agreement ---
test("resolveResumeGroup: locked beats company; company beats other", () => {
  assert.equal(resolveResumeGroup({ artifact_type: "resume", is_locked: true }), "masters");
  assert.equal(
    resolveResumeGroup({ artifact_type: "resume", is_locked: true, target_context: { targetCompany: "Acme" } }),
    "masters"
  );
  assert.equal(
    resolveResumeGroup({ artifact_type: "resume", target_context: { targetCompany: "Acme" } }),
    "company"
  );
  assert.equal(resolveResumeGroup({ artifact_type: "resume", target_context: { targetCompany: "  " } }), "other");
  assert.equal(resolveResumeGroup({ artifact_type: "resume" }), "other");
});

test("countResumeGroups partitions with no double-counting", () => {
  const rows = [
    { artifact_type: "resume", is_locked: true },
    { artifact_type: "resume", target_context: { targetCompany: "Acme" } },
    { artifact_type: "resume", target_context: { targetCompany: "Beta" } },
    { artifact_type: "resume" },
  ];
  const c = countResumeGroups(rows);
  assert.deepEqual(c, { masters: 1, company: 2, other: 1 });
  assert.equal(c.masters + c.company + c.other, rows.length);
});

test("RESUME_GROUP_PREDICATES keys match the resolver's groups", () => {
  assert.deepEqual(Object.keys(RESUME_GROUP_PREDICATES).sort(), [...RESUME_GROUP_KEYS].sort());
});

test("RESUME_GROUP_PREDICATES: SQL bucket agrees with the pure resolver", () => {
  // Emulate the SQL predicate in JS so the two implementations are checked to
  // partition identically for representative rows.
  const sqlBucket = (a: { is_locked?: boolean; targetCompany?: string }) => {
    if (a.is_locked === true) return "masters";
    const co = a.targetCompany ?? "";
    if (!a.is_locked && co !== "") return "company";
    return "other";
  };
  const cases = [
    { is_locked: true, targetCompany: "" },
    { is_locked: true, targetCompany: "Acme" },
    { is_locked: false, targetCompany: "Acme" },
    { is_locked: false, targetCompany: "" },
    { targetCompany: "Beta" },
    {},
  ];
  for (const c of cases) {
    const pure = resolveResumeGroup({
      artifact_type: "resume",
      is_locked: c.is_locked,
      target_context: { targetCompany: c.targetCompany ?? null },
    });
    assert.equal(pure, sqlBucket(c), JSON.stringify(c));
  }
});

test("isResumeGroup guards the query param", () => {
  assert.ok(isResumeGroup("masters"));
  assert.equal(isResumeGroup("everything"), false);
});

// --- zipStore CRC32 + STORE round-trip ---
test("crc32 matches the canonical check value for '123456789'", () => {
  assert.equal(crc32(Buffer.from("123456789")) >>> 0, 0xcbf43926);
});

test("createStoreZip: valid signatures, entry count, and byte-exact STORE round-trip", () => {
  const entries = [
    { name: "id.txt", data: Buffer.from("state id bytes") },
    { name: "letter.txt", data: Buffer.from("a reference letter, longer content here") },
    { name: "empty.txt", data: Buffer.from("") },
  ];
  const zip = createStoreZip(entries);

  // Local + EOCD signatures present.
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "first local header signature");
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, "EOCD signature");
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), entries.length, "EOCD total entries");

  // Walk the local headers, extract each STORE payload, verify CRC + bytes.
  let off = 0;
  for (const entry of entries) {
    assert.equal(zip.readUInt32LE(off), 0x04034b50, `local sig for ${entry.name}`);
    const method = zip.readUInt16LE(off + 8);
    assert.equal(method, 0, "STORE method");
    const crc = zip.readUInt32LE(off + 14);
    const csize = zip.readUInt32LE(off + 18);
    const usize = zip.readUInt32LE(off + 22);
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    assert.equal(csize, usize, "STORE: compressed == uncompressed");
    const name = zip.slice(off + 30, off + 30 + nameLen).toString("utf8");
    assert.equal(name, entry.name);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = zip.slice(dataStart, dataStart + csize);
    assert.deepEqual(Buffer.from(data), Buffer.from(entry.data), `bytes for ${entry.name}`);
    assert.equal(crc32(data) >>> 0, crc >>> 0, `crc for ${entry.name}`);
    off = dataStart + csize;
  }
  // After the last local entry, the central directory begins.
  assert.equal(zip.readUInt32LE(off), 0x02014b50, "central directory signature");
});

test("VAULT_MIME_ALLOWLIST has no duplicates", () => {
  assert.equal(new Set(VAULT_MIME_ALLOWLIST).size, VAULT_MIME_ALLOWLIST.length);
});
