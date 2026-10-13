import { describe, expect, it } from "vitest";
import { formatReleaseNotes } from "../../scripts/lib/release-notes.js";

describe("release notes", () => {
  it("groups Conventional Commits and links the diff", () => {
    const notes = formatReleaseNotes(
      [
        { hash: "a1", subject: "chore(release): 0.2.0" },
        { hash: "b2", subject: "feat(web): save a still image" },
        { hash: "c3", subject: "fix: simulator with ffmpeg 7" },
        { hash: "d4", subject: "ci: add workflows" },
        { hash: "e5", subject: "Update README" },
        { hash: "f6", subject: "feat!: new config format" },
      ],
      {
        version: "0.2.0",
        tag: "v0.2.0",
        previousTag: "v0.1.0",
        repoUrl: "https://git.example.de/o/r",
        zipName: "hub-0.2.0-win-x64.zip",
        sha256: "abc",
      },
    );
    expect(notes).toBe(
      [
        "## Drone Live Stream Hub 0.2.0",
        "",
        "Windows package: `hub-0.2.0-win-x64.zip` – install Node.js 24 LTS first (nodejs.org, .msi), then unpack and run `install.cmd` (see README.md in the ZIP).",
        "",
        "SHA-256: `abc`",
        "",
        "### Features",
        "",
        "- **web:** save a still image (b2)",
        "- new config format **(breaking)** (f6)",
        "",
        "### Fixes",
        "",
        "- simulator with ffmpeg 7 (c3)",
        "",
        "### Other changes",
        "",
        "- add workflows (d4)",
        "- Update README (e5)",
        "",
        "Full diff: https://git.example.de/o/r/compare/v0.1.0...v0.2.0",
        "",
      ].join("\n"),
    );
  });

  it("handles the first release and empty ranges", () => {
    const notes = formatReleaseNotes([], { version: "0.1.0", tag: "v0.1.0", previousTag: null });
    expect(notes).toContain("No changes since the previous release.");
    expect(notes).toContain("First release.");
  });
});
