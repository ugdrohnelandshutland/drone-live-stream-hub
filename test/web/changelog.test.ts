import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { changelog } from "../../src/web/features/about/changelog";

describe("changelog", () => {
  it("has an entry for the version in package.json, newest first", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    expect(changelog[0]?.version, "add a changelog entry with every release").toBe(pkg.version);
  });

  it("lists each version once, in descending order, with a date and changes", () => {
    // Fits three numbers of up to 999 each into one comparable number; a beta (0.10.0-beta.2)
    // ranks below its release and above earlier betas.
    const rank = (version: string) => {
      const [release = "", beta] = version.split("-beta.");
      const base = release.split(".").reduce((sum, part) => sum * 1000 + Number(part), 0);
      return base * 1000 + (beta === undefined ? 999 : Number(beta));
    };
    const ranks = changelog.map((r) => rank(r.version));
    expect(ranks.every(Number.isFinite), "versions look like 1.2.3 or 1.2.3-beta.4").toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(ranks).size).toBe(ranks.length);
    for (const release of changelog) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.changes.length).toBeGreaterThan(0);
    }
  });
});
