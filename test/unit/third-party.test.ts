import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectPackages, packageDirOf } from "../../scripts/lib/third-party.js";

const root = path.resolve(import.meta.dirname, "..", "..");

describe("third-party notices", () => {
  it("finds the package of a bundled module id", () => {
    expect(packageDirOf("/r/node_modules/ws/lib/websocket.js")).toBe("/r/node_modules/ws");
    expect(packageDirOf("/r/node_modules/@pinojs/redact/index.js")).toBe("/r/node_modules/@pinojs/redact");
    expect(packageDirOf("/r/node_modules/a/node_modules/b/x.js")).toBe("/r/node_modules/a/node_modules/b");
    expect(packageDirOf("\0/r/node_modules/react/index.js?commonjs-proxy")).toBe("/r/node_modules/react");
    expect(packageDirOf("/r/src/server/index.ts")).toBeUndefined();
  });

  it("lists each package once with its license text, plus what prebuilt packages inline", async () => {
    const modules = (name: string, ...files: string[]) =>
      files.map((f) => path.join(root, "node_modules", name, f));
    const packages = await collectPackages(root, [
      ...modules("ws", "index.js", "lib/websocket.js"),
      ...modules("mpegts.js", "dist/mpegts.js"),
    ]);
    const names = packages.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names.filter((n) => n === "ws")).toHaveLength(1);
    expect(names).toContain("mpegts.js");
    expect(names).toContain("es6-promise"); // inlined into mpegts.js' dist file
    expect(packages.find((p) => p.name === "ws")).toMatchObject({ license: "MIT", version: "8.22.0" });
    expect(packages.find((p) => p.name === "ws")?.licenseText).toMatch(/Permission is hereby granted/);
  });
});
