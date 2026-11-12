import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { readZipEntries } from "../../src/lib/zip.js";

/** Builds a one-entry ZIP (deflate) by hand, as the format specifies. */
function makeZip(name: string, data: Buffer, crc: number): Buffer {
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  const cdOffset = local.length + n.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + n.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, comp, central, n, eocd]);
}

describe("readZipEntries", () => {
  const data = Buffer.from("hello zip ".repeat(100));

  it("inflates a deflate entry and checks its CRC-32", async () => {
    const { crc32 } = await import("node:zlib");
    const entries = readZipEntries(makeZip("a.txt", data, crc32(data)));
    expect(entries.get("a.txt")?.toString()).toBe(data.toString());
  });

  it("rejects a wrong CRC-32", () => {
    expect(() => readZipEntries(makeZip("a.txt", data, 123))).toThrow(/CRC/);
  });

  it("rejects entries above the size limit", () => {
    expect(() => readZipEntries(makeZip("a.txt", data, 0), 10)).toThrow(/too large/);
  });

  it("rejects data that is not a ZIP", () => {
    expect(() => readZipEntries(Buffer.from("not a zip at all, definitely not"))).toThrow();
  });
});
