// Prints the release notes for a tag (commits since the previous tag) as Markdown.
//   npx tsx scripts/release-notes.ts v0.2.0 [--zip <file> --sha256 <hash> --repo-url <url>]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatReleaseNotes, type CommitLine } from "./lib/release-notes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { zip: { type: "string" }, sha256: { type: "string" }, "repo-url": { type: "string" } },
});
const tag = positionals[0];
if (!tag) {
  console.error("usage: release-notes.ts <tag> [--zip <file>] [--sha256 <hash>] [--repo-url <url>]");
  process.exit(2);
}

// A final release lists everything since the previous final release, skipping its betas;
// a pre-release (v0.10.0-beta.2) lists what changed since the tag before it.
const skipPrereleases = tag.includes("-") ? [] : ["--exclude", "*-*"];
let previousTag: string | null = null;
try {
  previousTag = git("describe", "--tags", "--abbrev=0", ...skipPrereleases, `${tag}^`);
} catch {
  // first release: no earlier tag
}
const range = previousTag ? `${previousTag}..${tag}` : tag;
const commits: CommitLine[] = git("log", "--no-merges", "--format=%h%x09%s", range)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash = "", ...rest] = line.split("\t");
    return { hash, subject: rest.join("\t") };
  });
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };

process.stdout.write(
  formatReleaseNotes(commits, {
    version,
    tag,
    previousTag,
    ...(values["repo-url"] ? { repoUrl: values["repo-url"] } : {}),
    ...(values.zip ? { zipName: path.basename(values.zip) } : {}),
    ...(values.sha256 ? { sha256: values.sha256 } : {}),
  }),
);
