/**
 * Dependency-free, STORE-only (no compression) ZIP writer.
 *
 * Phase 6.2 "download my vault" streams the user's decrypted files as a single
 * ZIP. We deliberately avoid a new npm dependency: the vault holds a handful of
 * documents (PDFs, photos, a note), so compression buys little and a
 * hand-rolled DEFLATE would be the risky part. STORE (method 0) just concatenates
 * the raw bytes behind correct headers -- the format surface we must get right is
 * the local file header, the central directory, and CRC32. All three are covered
 * by the zipStore round-trip test in the adversarial suite.
 *
 * Scope: files only (no directory entries), UTF-8 filenames, sizes well under
 * 4 GiB (no ZIP64). Every file uses the UTF-8 language-encoding flag (bit 11).
 */

// --- CRC32 (IEEE 802.3, the polynomial ZIP uses) ---
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Filename inside the archive (already made safe/unique by the caller). */
  name: string;
  /** Raw file bytes. */
  data: Uint8Array;
}

/** DOS date/time from a JS Date (local ZIP convention). Clamped to the 1980+
 *  range the format allows. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date =
    ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | (d.getDate() & 0x1f);
  return { time: time & 0xffff, date: date & 0xffff };
}

/**
 * Build a STORE-only ZIP archive as a single Buffer.
 *
 * Layout: [local header + data] per entry, then [central directory header] per
 * entry, then the end-of-central-directory record.
 */
export function createStoreZip(entries: ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const encoder = new TextEncoder();

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0; // running offset of each local header from the archive start

  for (const entry of entries) {
    const nameBytes = Buffer.from(encoder.encode(entry.name));
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const size = data.length;

    // --- Local file header (30 bytes + name) ---
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0x0800, 6); // flags: bit 11 = UTF-8 filename
    local.writeUInt16LE(0, 8); // compression method: 0 = STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size == uncompressed (STORE)
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBytes, data);

    // --- Central directory header (46 bytes + name) ---
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8
    central.writeUInt16LE(0, 10); // method: STORE
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // offset of local header
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);

  // --- End of central directory record (22 bytes) ---
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(localBuf.length, 16); // central dir offset (== end of local data)
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}
