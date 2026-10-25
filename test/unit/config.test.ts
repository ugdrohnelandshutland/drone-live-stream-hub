import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEnvOverrides,
  ConfigError,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  resolveDataDir,
} from "../../src/server/config.js";

const valid = {
  rtmpPort: 1935,
  httpPort: 8080,
  drones: [
    { id: "m30t-01", name: "Drohne 1" },
    { id: "m30t-02", name: "Drohne 2" },
  ],
};

describe("parseConfig", () => {
  it("accepts a valid config", () => {
    expect(parseConfig(valid)).toEqual(valid);
  });

  it("accepts an admin PIN of 4 to 12 digits as a string, leading zeros included", () => {
    expect(parseConfig({ ...valid, adminPin: "0042" }).adminPin).toBe("0042");
    expect(parseConfig(valid).adminPin).toBeUndefined();
    for (const adminPin of ["123", "1234567890123", "12a4", 1234]) {
      expect(() => parseConfig({ ...valid, adminPin })).toThrow(/adminPin/);
    }
  });

  it("applies default ports", () => {
    const config = parseConfig({ drones: valid.drones });
    expect(config.rtmpPort).toBe(1935);
    expect(config.httpPort).toBe(8080);
  });

  it.each(["M30T-01", "m30t_01", "", "a".repeat(33), "drone 1"])("rejects drone id %j", (id) => {
    expect(() => parseConfig({ drones: [{ id, name: "x" }] })).toThrow(ConfigError);
  });

  it("rejects duplicate ids with a readable message", () => {
    expect(() => parseConfig({ drones: [valid.drones[0], valid.drones[0]] })).toThrow(
      /drones\.1\.id: duplicate drone id "m30t-01"/,
    );
  });

  it("rejects unknown keys, empty drone lists and invalid ports", () => {
    expect(() => parseConfig({ ...valid, extra: true })).toThrow(ConfigError);
    expect(() => parseConfig({ drones: [] })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, rtmpPort: 70000 })).toThrow(/rtmpPort/);
  });
});

describe("resolveConfigPath", () => {
  const cwd = path.resolve("/srv/hub");

  it("prefers --config over the environment", () => {
    expect(resolveConfigPath(["--config", "a.json"], { DLSH_CONFIG: "b.json" }, cwd)).toBe(
      path.join(cwd, "a.json"),
    );
    expect(resolveConfigPath(["--config=c.json"], {}, cwd)).toBe(path.join(cwd, "c.json"));
  });

  it("falls back to the environment, then the default", () => {
    expect(resolveConfigPath([], { DLSH_CONFIG: "b.json" }, cwd)).toBe(path.join(cwd, "b.json"));
    expect(resolveConfigPath([], {}, cwd)).toBe(path.join(cwd, "config", "drones.json"));
  });

  it("requires a value for --config", () => {
    expect(() => resolveConfigPath(["--config"], {}, cwd)).toThrow(ConfigError);
  });
});

describe("loadConfig", () => {
  it("reports a missing file with a hint", async () => {
    await expect(loadConfig(path.join(os.tmpdir(), "does-not-exist.json"))).rejects.toThrow(
      /ENOENT.*example/,
    );
  });

  it("reports invalid JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dlsh-config-"));
    const file = path.join(dir, "drones.json");
    await writeFile(file, "{ nope");
    await expect(loadConfig(file)).rejects.toThrow(/not valid JSON/);
  });

  it("accepts a UTF-8 byte order mark (Windows Notepad)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dlsh-config-"));
    const file = path.join(dir, "drones.json");
    await writeFile(file, '﻿{ "drones": [{ "id": "m30t-01", "name": "Drohne 1" }] }', "utf8");
    expect((await loadConfig(file)).drones).toHaveLength(1);
  });

  it("loads the shipped example", async () => {
    const config = await loadConfig(path.join("config", "drones.example.json"));
    expect(config.drones.length).toBeGreaterThan(0);
  });
});

describe("resolveDataDir", () => {
  const configPath = path.resolve("install", "config", "drones.json");

  it("defaults to data next to the config folder", () => {
    expect(resolveDataDir([], {}, configPath)).toBe(path.resolve("install", "data"));
  });

  it("prefers --data-dir, then the environment", () => {
    expect(resolveDataDir(["--data-dir", "x"], { DLSH_DATA_DIR: "y" }, configPath)).toBe(path.resolve("x"));
    expect(resolveDataDir(["--data-dir=z"], {}, configPath)).toBe(path.resolve("z"));
    expect(resolveDataDir([], { DLSH_DATA_DIR: "y" }, configPath)).toBe(path.resolve("y"));
    expect(() => resolveDataDir(["--data-dir"], {}, configPath)).toThrow(ConfigError);
  });
});

describe("applyEnvOverrides", () => {
  const base = parseConfig(valid);

  it("takes the admin PIN from DLSH_ADMIN_PIN before the file", () => {
    const fromFile = { ...base, adminPin: "1111" };
    expect(applyEnvOverrides(fromFile, { DLSH_ADMIN_PIN: "0042" })).toEqual({
      config: { ...base, adminPin: "0042" },
      adminPinSource: "env",
    });
    expect(applyEnvOverrides(fromFile, { DLSH_ADMIN_PIN: " " }).adminPinSource).toBe("config");
    expect(applyEnvOverrides(base, {})).toEqual({ config: base, adminPinSource: undefined });
  });

  it("rejects an invalid PIN from the environment", () => {
    expect(() => applyEnvOverrides(base, { DLSH_ADMIN_PIN: "12a4" })).toThrow(/DLSH_ADMIN_PIN/);
  });
});
