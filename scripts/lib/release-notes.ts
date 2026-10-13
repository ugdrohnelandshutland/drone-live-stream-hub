// Release notes from Conventional Commit subjects (pure, unit-tested).

export interface CommitLine {
  hash: string;
  subject: string;
}

export interface ReleaseNotesOptions {
  version: string;
  previousTag: string | null;
  /** e.g. https://git.example.de/owner/repo, for the compare link. */
  repoUrl?: string;
  tag: string;
  zipName?: string;
  sha256?: string;
}

const SECTIONS: { title: string; types: string[] }[] = [
  { title: "Features", types: ["feat"] },
  { title: "Fixes", types: ["fix"] },
  { title: "Other changes", types: [] },
];

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/** Markdown body for a release. Release commits ("chore(release): …") are left out. */
export function formatReleaseNotes(commits: CommitLine[], options: ReleaseNotesOptions): string {
  const grouped = new Map<string, string[]>(SECTIONS.map((s) => [s.title, []]));
  for (const { hash, subject } of commits) {
    const match = CONVENTIONAL.exec(subject);
    const type = match?.[1] ?? "";
    if (type === "chore" && match?.[2] === "release") continue;
    const scope = match?.[2];
    const text = match?.[4] ?? subject;
    const breaking = match?.[3] ? " **(breaking)**" : "";
    const line = `- ${scope ? `**${scope}:** ` : ""}${text}${breaking} (${hash})`;
    const section = SECTIONS.find((s) => s.types.includes(type))?.title ?? "Other changes";
    grouped.get(section)?.push(line);
  }

  const parts = [`## Drone Live Stream Hub ${options.version}`, ""];
  if (options.zipName) {
    parts.push(
      `Windows package: \`${options.zipName}\` – install Node.js 24 LTS first (nodejs.org, .msi), then unpack and run \`install.cmd\` (see README.md in the ZIP).`,
    );
    if (options.sha256) parts.push("", `SHA-256: \`${options.sha256}\``);
    parts.push("");
  }
  let any = false;
  for (const { title } of SECTIONS) {
    const lines = grouped.get(title) ?? [];
    if (lines.length === 0) continue;
    any = true;
    parts.push(`### ${title}`, "", ...lines, "");
  }
  if (!any) parts.push("No changes since the previous release.", "");
  if (options.previousTag && options.repoUrl) {
    parts.push(`Full diff: ${options.repoUrl}/compare/${options.previousTag}...${options.tag}`, "");
  } else if (!options.previousTag) {
    parts.push("First release.", "");
  }
  return parts.join("\n");
}
