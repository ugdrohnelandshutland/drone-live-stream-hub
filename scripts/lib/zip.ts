// Minimal ZIP reader/writer for packaging (no ZIP64, no encryption). Enough to take shawl
// out of its release archives and to ship the Windows package as one file, on any build OS,
// without extra dependencies.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_32 = 0xffffffff;

export interface ZipEntry {
  /** Forward slashes, no leading slash. */
  name: string;
  data: Buffer;
}

/** Reads all file entries (directories are skipped) and verifies their CRC. */
export function readZip(archive: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  if (offset === MAX_32) throw new Error("ZIP64 archives are not supported");
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(offset) !== CENTRAL_HEADER) throw new Error("corrupt central directory");
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const crc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString(
      flags & FLAG_UTF8 ? "utf8" : "latin1",
      offset + 46,
      offset + 46 + nameLength,
    );
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (compressedSize === MAX_32 || size === MAX_32 || localOffset === MAX_32) {
      throw new Error(`ZIP64 entry not supported: ${name}`);
    }

    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new Error(`corrupt local header: ${name}`);
    const dataStart =
      localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    const raw = archive.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === METHOD_STORE) data = Buffer.from(raw);
    else if (method === METHOD_DEFLATE) data = inflateRawSync(raw);
    else throw new Error(`unsupported compression method ${method}: ${name}`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`checksum mismatch: ${name}`);
    entries.push({ name: name.replaceAll("\\", "/"), data });
  }
  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65535 bytes.
  const stop = Math.max(0, archive.length - 22 - 0xffff);
  for (let i = archive.length - 22; i >= stop; i--) {
    if (archive.readUInt32LE(i) === END_OF_CENTRAL_DIR) return i;
  }
  throw new Error("not a ZIP archive");
}

/** MS-DOS date/time as stored in ZIP headers (local time, 2 s resolution). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Writes a deflate-compressed archive. Same input and date → same bytes. */
export function writeZip(entries: readonly ZipEntry[], modified: Date): Buffer {
  const stamp = dosDateTime(modified);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    const crc = crc32(entry.data);
    if (offset + 30 + name.length + body.length > MAX_32)
      throw new Error("archive too large for ZIP without ZIP64");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(stored ? METHOD_STORE : METHOD_DEFLATE, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4); // made by: MS-DOS, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(stored ? METHOD_STORE : METHOD_DEFLATE, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIR, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
