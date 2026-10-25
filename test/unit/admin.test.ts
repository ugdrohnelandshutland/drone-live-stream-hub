import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AdminAuth } from "../../src/server/admin/admin-auth.js";
import { EventLog } from "../../src/server/admin/event-log.js";
import { FileClientNames } from "../../src/server/clients/client-names.js";
import { createLogger } from "../../src/server/logger.js";

const logger = createLogger({ name: "test", level: "silent" });

describe("AdminAuth", () => {
  it("creates a session for the right PIN and accepts only its token", () => {
    const auth = new AdminAuth({ pin: "0042" });
    const result = auth.login("0042", "10.0.0.7");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(auth.check(result.token)).toBe(true);
    expect(auth.check("guess")).toBe(false);
    expect(auth.check(undefined)).toBe(false);
    auth.logout(result.token);
    expect(auth.check(result.token)).toBe(false);
  });

  it("locks an address out after five wrong PINs, then lets it try again", () => {
    let now = 0;
    const auth = new AdminAuth({ pin: "1234", now: () => now });
    for (let i = 0; i < 4; i++) {
      expect(auth.login("0000", "10.0.0.7")).toEqual({ ok: false, lockedForMs: undefined });
    }
    expect(auth.login("0000", "10.0.0.7")).toEqual({ ok: false, lockedForMs: 60_000 });
    // Locked: even the right PIN is refused; other addresses are not affected.
    now = 30_000;
    expect(auth.login("1234", "10.0.0.7")).toEqual({ ok: false, lockedForMs: 30_000 });
    expect(auth.login("1234", "10.0.0.8").ok).toBe(true);

    now = 60_000;
    expect(auth.login("0000", "10.0.0.7")).toEqual({ ok: false, lockedForMs: undefined });
    expect(auth.login("1234", "10.0.0.7").ok).toBe(true);
  });
});

describe("EventLog", () => {
  it("numbers events, returns the newer ones and keeps only the newest", () => {
    const log = new EventLog(3, () => new Date("2026-10-25T10:00:00Z"));
    for (const droneId of ["a", "b", "c", "d"]) log.add({ kind: "drone-live", droneId });
    expect(log.after(0).map((e) => [e.seq, e.droneId])).toEqual([
      [2, "b"],
      [3, "c"],
      [4, "d"],
    ]);
    expect(log.after(3).map((e) => e.seq)).toEqual([4]);
    expect(log.after(4)).toEqual([]);
    expect(log.after(0)[0]?.at).toBe("2026-10-25T10:00:00.000Z");
  });
});

describe("FileClientNames", () => {
  it("saves names and loads them again", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dlsh-names-"));
    const names = new FileClientNames(path.join(dir, "data"), logger);
    await names.load(); // no file yet: no names
    names.set("tablet-1", "ELW");
    names.set("tablet-2", "Abschnitt Nord");
    names.set("tablet-2", undefined);
    await names.flush();

    const text = await readFile(path.join(dir, "data", "clients.json"), "utf8");
    expect(JSON.parse(text)).toMatchObject({ version: 1, clients: { "tablet-1": { name: "ELW" } } });
    const again = new FileClientNames(path.join(dir, "data"), logger);
    await again.load();
    expect(again.get("tablet-1")).toBe("ELW");
    expect(again.get("tablet-2")).toBeUndefined();
  });

  it("starts without names when the file is broken", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dlsh-names-"));
    await writeFile(path.join(dir, "clients.json"), "{ not json");
    const names = new FileClientNames(dir, logger);
    await names.load();
    expect(names.get("tablet-1")).toBeUndefined();
  });
});
