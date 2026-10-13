import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

describe("vite dev server", () => {
  it("serves no web module under a path it proxies to the service", () => {
    // A folder src/web/api/ would be requested as /api/… in dev and end up at the service (404).
    const proxied = Object.keys(viteConfig.server?.proxy ?? {}).map((prefix) => prefix.replace(/^\//, ""));
    const entries = readdirSync(path.join(import.meta.dirname, "../../src/web"));
    expect(proxied.length).toBeGreaterThan(0);
    expect(entries.filter((entry) => proxied.includes(entry))).toEqual([]);
  });
});
