import { crc32, inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
/** Upper bound for one decompressed entry: protects against zip bombs. */
export const MAX_ENTRY_BYTES = 1024 * 1024 * 1024;

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("ZIP: end of central directory not found");
}

/**
 * Reads every file of a plain (non-ZIP64, unencrypted) ZIP archive into memory.
 * Supports the stored and deflate methods, and checks each entry's CRC-32.
 */
export function readZipEntries(buf: Buffer, maxEntryBytes = MAX_ENTRY_BYTES): Map<string, Buffer> {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error("ZIP: bad central directory");
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw new Error(`ZIP: encrypted entry ${name}`);
    if ([compressedSize, size, localOffset].includes(ZIP64_MARKER)) {
      throw new Error(`ZIP: ZIP64 entry ${name} is not supported`);
    }
    if (size > maxEntryBytes) throw new Error(`ZIP: entry ${name} is too large (${size} bytes)`);
    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error("ZIP: bad local header");
    const start =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);

    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
    else throw new Error(`ZIP: unsupported compression method ${method} for ${name}`);

    if (data.length !== size || crc32(data) !== crc) {
      throw new Error(`ZIP: size or CRC-32 mismatch in ${name}`);
    }
    entries.set(name, data);
  }
  return entries;
}
