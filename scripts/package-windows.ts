// Builds the Windows package: release/drone-live-stream-hub-<version>-win-x64/ and a .zip of it.
//
//   npm run package:windows            (runs `npm run build` first)
//
// Contents: the server bundled into one file (no node_modules), the built web UI, the shawl
// service wrapper, install/uninstall scripts and license notices. Node.js is not included:
// the field PC needs Node.js 24 LTS installed (ADR 0008). Downloads are cached in
// .cache/downloads and verified by SHA-256, so a second run works offline. Works on Linux,
// macOS and Windows. See docs/decisions/0004 and 0008.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleServer, releaseInfo } from "./lib/bundle-server.js";
import type { ServiceInfo } from "../src/shared/api.js";
import { readZip, writeZip, type ZipEntry } from "./lib/zip.js";
import { THIRD_PARTY_FILE } from "./lib/third-party.js";
import type { ThirdPartyNotices, ThirdPartyPackage } from "../src/shared/third-party.js";

/** Node.js major the field PC must have installed; install-windows.ps1 checks the same. */
const NODE_MAJOR = 24;
const SHAWL_VERSION = "1.9.0";
/** From the GitHub release asset digests of mtkennerly/shawl v1.9.0. */
const SHAWL_SHA256 = {
  win64: "f883c5d09c9beae2efaeabd8513e7d3f57cd1d0864cec3df4f4a7b6ee904351c",
  legal: "a2a1743a64b79922062906eb32cdaf23db131769f8cabcc98e5d57bbf66eb0b0",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(root, ".cache", "downloads");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function download(url: string, expectedSha256: string): Promise<Buffer> {
  const file = path.join(cacheDir, path.basename(new URL(url).pathname));
  try {
    const cached = await readFile(file);
    if (sha256(cached) === expectedSha256) return cached;
  } catch {
    // not cached yet
  }
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url} (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expectedSha256) {
    throw new Error(`checksum mismatch for ${url}\n  expected ${expectedSha256}\n  actual   ${actual}`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, data);
  return data;
}

function pick(entries: ZipEntry[], name: string): Buffer {
  const entry = entries.find((e) => e.name === name);
  if (!entry) throw new Error(`${name} not found in archive`);
  return entry.data;
}

// --- third-party notices --------------------------------------------------

/** Written by the web build (scripts/lib/third-party.ts); lists web UI and service packages. */
async function readNotices(): Promise<ThirdPartyPackage[]> {
  const file = path.join(root, "dist", "web", THIRD_PARTY_FILE);
  const notices = JSON.parse(await readFile(file, "utf8")) as ThirdPartyNotices;
  const byName = new Map([...notices.service, ...notices.web].map((p) => [`${p.name}@${p.version}`, p]));
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function formatNotices(packages: ThirdPartyPackage[], extra: ThirdPartyPackage[]): string {
  const sections = [...extra, ...packages].map(
    (p) =>
      `${"=".repeat(78)}\n${p.name} ${p.version} (${p.license})\n${"=".repeat(78)}\n\n${p.licenseText}\n`,
  );
  return (
    "Drone Live Stream Hub includes the following third-party software.\n\n" + sections.join("\n")
  ).replaceAll(/\r?\n/g, "\r\n");
}

// --- smoke test -----------------------------------------------------------

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** Starts the bundled server with the local Node.js and checks /healthz and the web UI. */
async function smokeTest(packageDir: string, info: ServiceInfo): Promise<void> {
  const [rtmpPort, httpPort] = [await freePort(), await freePort()];
  const tmp = await mkdirTemp();
  const configPath = path.join(tmp, "drones.json");
  await writeFile(
    configPath,
    JSON.stringify({ rtmpPort, httpPort, drones: [{ id: "smoke", name: "Smoke" }] }),
  );
  const child = spawn(
    process.execPath,
    [path.join(packageDir, "app", "server.mjs"), "--config", configPath],
    {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, LOG_LEVEL: "warn" },
    },
  );
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        const health = await fetch(`http://127.0.0.1:${httpPort}/healthz`);
        if (health.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error("smoke test: service did not answer /healthz");
      await new Promise((r) => setTimeout(r, 200));
    }
    const page = await fetch(`http://127.0.0.1:${httpPort}/drone/smoke`);
    const html = await page.text();
    if (!page.ok || !html.includes("<script")) throw new Error("smoke test: web UI not served");
    const drones = (await (await fetch(`http://127.0.0.1:${httpPort}/api/drones`)).json()) as {
      drones: { id: string }[];
    };
    if (drones.drones[0]?.id !== "smoke") throw new Error("smoke test: unexpected /api/drones");
    const served = (await (await fetch(`http://127.0.0.1:${httpPort}/api/info`)).json()) as ServiceInfo;
    if (JSON.stringify(served) !== JSON.stringify(info)) {
      throw new Error(
        `smoke test: /api/info is ${JSON.stringify(served)}, expected the baked-in release info`,
      );
    }
  } finally {
    child.kill("SIGINT");
    const code = await exited;
    await rm(tmp, { recursive: true, force: true });
    if (code !== 0 && code !== null) console.warn(`smoke test: service exited with ${code}`);
  }
  console.log("smoke test passed (bundle serves /healthz, /api/drones, /api/info and the web UI)");
}

async function mkdirTemp(): Promise<string> {
  const dir = path.join(os.tmpdir(), `dlsh-package-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// --- main -----------------------------------------------------------------

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(full, base)));
    else result.push(path.relative(base, full));
  }
  return result.sort();
}

/** Windows tools (Notepad, PowerShell 5.1) handle CRLF best. */
const crlf = (text: string) => text.replaceAll(/\r?\n/g, "\r\n");

async function main(): Promise<void> {
  // The smoke test runs the bundle with this Node.js: it must be the one the field PC has.
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== NODE_MAJOR) {
    throw new Error(`package with Node.js ${NODE_MAJOR}.x (running ${process.versions.node})`);
  }
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version: string };
  const name = `drone-live-stream-hub-${pkg.version}-win-x64`;
  const releaseDir = path.join(root, "release");
  const out = path.join(releaseDir, name);
  const webDir = path.join(root, "dist", "web");
  try {
    await stat(path.join(webDir, "index.html"));
  } catch {
    throw new Error("dist/web is missing: run `npm run build` first (npm run package:windows does)");
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const builtAt = new Date();
  const info = await releaseInfo(root, builtAt);
  await bundleServer(root, path.join(out, "app"), info);

  // Service wrapper.
  const shawlBase = `https://github.com/mtkennerly/shawl/releases/download/v${SHAWL_VERSION}`;
  const shawlZip = readZip(
    await download(`${shawlBase}/shawl-v${SHAWL_VERSION}-win64.zip`, SHAWL_SHA256.win64),
  );
  const shawlLegal = readZip(
    await download(`${shawlBase}/shawl-v${SHAWL_VERSION}-legal.zip`, SHAWL_SHA256.legal),
  );
  await mkdir(path.join(out, "shawl", "legal"), { recursive: true });
  await writeFile(path.join(out, "shawl", "shawl.exe"), pick(shawlZip, "shawl.exe"));
  for (const entry of shawlLegal) {
    await writeFile(path.join(out, "shawl", "legal", path.basename(entry.name)), entry.data);
  }

  // Configuration, scripts and docs.
  await mkdir(path.join(out, "config"), { recursive: true });
  await cp(path.join(root, "config", "drones.example.json"), path.join(out, "config", "drones.example.json"));
  for (const script of ["install-windows.ps1", "uninstall-windows.ps1", "install.cmd", "uninstall.cmd"]) {
    const text = await readFile(path.join(root, "scripts", script), "utf8");
    await writeFile(path.join(out, script), crlf(text));
  }
  await writeFile(
    path.join(out, "README.md"),
    crlf(await readFile(path.join(root, "docs", "windows-install.md"), "utf8")),
  );

  const notices = await readNotices();
  await writeFile(
    path.join(out, "THIRD-PARTY-NOTICES.txt"),
    formatNotices(notices, [
      {
        name: "shawl",
        version: SHAWL_VERSION,
        license: "MIT",
        licenseText: `The license texts of shawl and of the libraries it uses are in shawl\\legal\\shawl-v${SHAWL_VERSION}-legal.txt.`,
      },
    ]),
  );
  await writeFile(
    path.join(out, "build-info.json"),
    JSON.stringify(
      {
        ...info,
        node: `${NODE_MAJOR}.x`,
        shawl: SHAWL_VERSION,
      },
      null,
      2,
    ) + "\n",
  );

  await smokeTest(out, info);

  const files = await listFiles(out);
  const entries: ZipEntry[] = await Promise.all(
    files.map(async (file) => ({
      name: `${name}/${file.split(path.sep).join("/")}`,
      data: await readFile(path.join(out, file)),
    })),
  );
  const zipPath = path.join(releaseDir, `${name}.zip`);
  await writeFile(zipPath, writeZip(entries, builtAt));
  const zipSize = (await stat(zipPath)).size;
  console.log(
    `\n${files.length} files in ${path.relative(root, out)}\n` +
      `${path.relative(root, zipPath)} (${(zipSize / 1024 / 1024).toFixed(1)} MB), ` +
      `${notices.length} bundled third-party packages listed in THIRD-PARTY-NOTICES.txt`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
