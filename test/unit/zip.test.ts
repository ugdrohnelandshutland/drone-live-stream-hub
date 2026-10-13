import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "../../scripts/lib/zip.js";

describe("zip", () => {
  const entries = [
    { name: "pkg/README.md", data: Buffer.from("hello ".repeat(1000)) }, // deflated
    { name: "pkg/node/random.bin", data: randomBytes(5000) }, // incompressible → stored
    { name: "pkg/empty.txt", data: Buffer.alloc(0) },
    { name: "pkg/übersicht.txt", data: Buffer.from("UTF-8 name") },
  ];
  const date = new Date(2026, 9, 10, 12, 30, 42);

  it("round-trips files, compressed and stored", () => {
    const archive = writeZip(entries, date);
    expect(archive.length).toBeLessThan(5000 + 2000);
    const read = readZip(archive);
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    read.forEach((entry, i) => expect(entry.data.equals(entries[i]!.data)).toBe(true));
  });

  it("is deterministic for the same input and date", () => {
    expect(writeZip(entries, date).equals(writeZip(entries, date))).toBe(true);
  });

  it("detects corruption", () => {
    const archive = writeZip([{ name: "a.txt", data: Buffer.from("abcdef".repeat(100)) }], date);
    archive[40] = archive[40]! ^ 0xff; // inside the compressed data
    expect(() => readZip(archive)).toThrow();
    expect(() => readZip(Buffer.from("not a zip file at all, definitely not"))).toThrow(/not a ZIP/);
  });
});
