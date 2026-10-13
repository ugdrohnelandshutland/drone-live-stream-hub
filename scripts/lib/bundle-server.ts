// Bundles the service into one ES module with the built web UI next to it: the artifact
// shipped in the Windows package and in the Docker image. Release info is baked in.
import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "rolldown";
import { readGitCommit, SERVICE_NAME } from "../../src/server/build-info.js";
import type { ServiceInfo } from "../../src/shared/api.js";

/** Version from package.json; commit from DLSH_COMMIT (e.g. Docker builds without .git) or git. */
export async function releaseInfo(root: string, builtAt: Date): Promise<ServiceInfo> {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version: string };
  return {
    name: SERVICE_NAME,
    version: pkg.version,
    commit: process.env["DLSH_COMMIT"] || readGitCommit(root),
    builtAt: builtAt.toISOString(),
  };
}

/**
 * Writes <outDir>/server.mjs and <outDir>/web/. Node.js built-ins stay external; everything
 * else is inlined. License notices: scripts/lib/third-party.ts.
 */
export async function bundleServer(root: string, outDir: string, info: ServiceInfo): Promise<void> {
  const bundle = await build({
    input: path.join(root, "src", "server", "index.ts"),
    platform: "node",
    logLevel: "warn",
    transform: { define: { __DLSH_BUILD_INFO__: JSON.stringify(info) } },
    output: { file: path.join(outDir, "server.mjs"), format: "esm" },
  });
  const chunk = bundle.output.find((o) => o.type === "chunk");
  if (!chunk) throw new Error("bundle produced no chunk");
  await cp(path.join(root, "dist", "web"), path.join(outDir, "web"), { recursive: true });
}
