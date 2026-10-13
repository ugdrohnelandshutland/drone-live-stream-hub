// License notices for the third-party packages inlined into a bundle. Used by the Vite build
// (/third-party.json for the About dialog) and the Windows package (THIRD-PARTY-NOTICES.txt).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { rolldown } from "rolldown";
import type { ThirdPartyNotices, ThirdPartyPackage } from "../../src/shared/third-party.js";

/**
 * Packages that ship a prebuilt file with their own dependencies already inlined: those
 * dependencies never show up as module ids, so they are added from package.json.
 */
const PREBUILT = new Set(["mpegts.js"]);

async function readPackage(dir: string): Promise<ThirdPartyPackage & { dependencies: string[] }> {
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string;
    dependencies?: Record<string, string>;
  };
  const files = await readdir(dir);
  const licenseFile = files.find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? "see license text",
    licenseText: licenseFile ? (await readFile(path.join(dir, licenseFile), "utf8")).trim() : "",
    dependencies: Object.keys(pkg.dependencies ?? {}),
  };
}

/** Package directory for a bundled module id (handles scoped packages and nesting). */
export function packageDirOf(moduleId: string): string | undefined {
  const normalized = moduleId.replace(/^\0+/, "").split(path.sep).join("/");
  const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(normalized);
  return match?.[1];
}

/** The packages behind a bundle's module ids, sorted by name. */
export async function collectPackages(
  root: string,
  moduleIds: Iterable<string>,
): Promise<ThirdPartyPackage[]> {
  const dirs = new Set<string>();
  const queue: string[] = [];
  for (const id of moduleIds) {
    const dir = packageDirOf(id);
    if (dir) queue.push(dir);
  }
  const found = new Map<string, ThirdPartyPackage>();
  while (queue.length > 0) {
    const dir = queue.shift() ?? "";
    if (dirs.has(dir)) continue;
    dirs.add(dir);
    const { dependencies, ...pkg } = await readPackage(dir);
    found.set(dir, pkg);
    if (PREBUILT.has(pkg.name)) {
      for (const dep of dependencies)
        queue.push(path.join(root, "node_modules", dep).split(path.sep).join("/"));
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Module ids of the bundled service, without writing a file. */
export async function serviceModuleIds(root: string): Promise<string[]> {
  const bundle = await rolldown({
    input: path.join(root, "src", "server", "index.ts"),
    platform: "node",
    logLevel: "silent",
  });
  try {
    const { output } = await bundle.generate({ format: "esm" });
    return output.flatMap((o) => (o.type === "chunk" ? o.moduleIds : []));
  } finally {
    await bundle.close();
  }
}

export const THIRD_PARTY_FILE = "third-party.json";

/**
 * Emits /third-party.json next to the web UI: the packages of this web bundle and of the
 * bundled service. The dev server answers with empty lists (no bundle to inspect).
 */
export function thirdPartyNotices(root: string): Plugin {
  return {
    name: "dlsh-third-party-notices",
    configureServer(server) {
      server.middlewares.use(`/${THIRD_PARTY_FILE}`, (_req, res) => {
        const empty: ThirdPartyNotices = { web: [], service: [] };
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(empty));
      });
    },
    async generateBundle(_options, bundle) {
      const webIds = Object.values(bundle).flatMap((o) => (o.type === "chunk" ? o.moduleIds : []));
      const notices: ThirdPartyNotices = {
        web: await collectPackages(root, webIds),
        service: await collectPackages(root, await serviceModuleIds(root)),
      };
      this.emitFile({ type: "asset", fileName: THIRD_PARTY_FILE, source: JSON.stringify(notices) });
    },
  };
}
