import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticHandler } from "../../src/server/delivery/static-files.js";

describe("static file handler", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dlsh-static-"));
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "index.html"), "<html>app</html>");
    await writeFile(path.join(dir, "assets", "app-123.js"), "console.log(1)");
    await writeFile(path.join(os.tmpdir(), "dlsh-secret.txt"), "secret");
    const handler = createStaticHandler(dir);
    server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("serves files with content type and cache headers", async () => {
    const res = await fetch(`${base}/assets/app-123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("falls back to index.html for SPA routes", async () => {
    const res = await fetch(`${base}/drone/m30t-01`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("app");
  });

  it("returns 404 for missing assets and never leaves the root", async () => {
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    for (const p of [
      "/../dlsh-secret.txt",
      "/%2e%2e/dlsh-secret.txt",
      "/..%2fdlsh-secret.txt",
      "/..%5cdlsh-secret.txt",
    ]) {
      const res = await fetch(`${base}${p}`);
      expect(await res.text()).not.toContain("secret");
    }
  });
});
